import {
	GoogleGenAI,
	Type,
	GenerateContentResponse,
	Part,
} from '@google/genai';
import { BlogData, OutlineSection } from '../types';
import { retryWithBackoff } from '../utils/retryWithBackoff';

// Helper to safely extract text from Gemini response (handles non-text parts like thoughtSignature)
const extractTextFromResponse = (response: GenerateContentResponse): string => {
	// Always extract text parts directly to avoid triggering warning from response.text getter
	try {
		if (response.candidates && response.candidates[0]?.content?.parts) {
			const textParts = response.candidates[0].content.parts
				.filter((part: any) => part.text !== undefined)
				.map((part: any) => part.text)
				.join('');

			if (textParts) {
				return textParts;
			}
		}
	} catch (e) {
		console.error('❌ Failed to extract text from response:', e);
	}

	throw new Error('Unable to extract text from Gemini response');
};

const cleanAndParseJson = (text: string): any => {
	// The model might return JSON wrapped in markdown ```json ... ```
	const cleanedText = text
		.replace(/^```json\s*/, '')
		.replace(/```\s*$/, '')
		.trim();
	try {
		return JSON.parse(cleanedText);
	} catch (e) {
		console.error('Failed to parse JSON from model response:', text);
		// Throw a more informative error
		throw new Error(
			`Model returned invalid JSON. Response text: "${text}"`
		);
	}
};

const PLANNING_PROMPT = (data: BlogData): string => `
ROLE: You are a Blog Outline Planner Agent. Your task is to determine the main structure (H2 headings) for a comprehensive blog post.
INSTRUCTIONS:
1. Use the provided Title and Keywords to create a logical, comprehensive structure.
2. If the Reference Data is empty, use the Google Search Tool to understand the topic.
3. Generate exactly 5 to 10 H2 headings.
4. The final H2 heading MUST be a concluding section, such as "Conclusion", "Final Thoughts", or "Summary".
5. Output ONLY a clean JSON array of strings, where each string is an H2 heading. DO NOT add any other text, pre-amble, or comments.
6. If you cannot find sufficient context from search or reference data, output an empty array [].
7. PRIORITIZE the Title for topical scope and intent. Treat the Primary Keyword as an SEO/interlinking signal only. Do not pivot the topic to chase the keyword; keep the outline faithful to the Title and references.

DETAILS:
- Title: "${data.title}"
- Primary Keyword: "${data.primaryKeyword}"
- Secondary Keywords: "${data.secondaryKeywords.join(', ')}"
- Language: ${data.language}
- Reference Data Summary: ${data.referenceFiles.length} files and ${
	data.referenceUrls.length
} URLs provided.
 - Reference URLs to consult (via urlContext):
${data.referenceUrls.map((u) => `   - ${u}`).join('\n')}
`;

const EXECUTION_PROMPT = (
	data: BlogData,
	h2_name: string,
	h2_id: string
): string => `
ROLE: You are a Blog Section Detail Agent. Your task is to generate the H3 subheadings for a single H2 heading.
INSTRUCTIONS:
1. Use the provided H2 Name as the context for this section.
2. If the Reference Data is empty, use the Google Search Tool to fetch specific details for this H2.
3. Generate 3 to 5 relevant H3 subheadings for the H2.
4. Output ONLY a single JSON object that follows the specified format. DO NOT add any other text or comments.
5. PRIORITIZE the Title for topical scope and intent. Treat the Primary Keyword as an SEO/interlinking signal only, not as the section topic driver.

DETAILS:
- Blog Title: "${data.title}"
- H2 Section to detail: "${h2_name}"
- Primary Keyword: "${data.primaryKeyword}"
- Secondary Keywords: "${data.secondaryKeywords.join(', ')}"
- Reference Data Summary: ${data.referenceFiles.length} files and ${
	data.referenceUrls.length
} URLs provided.
 - Reference URLs to consult (via urlContext):
${data.referenceUrls.map((u) => `   - ${u}`).join('\n')}

EXAMPLE OUTPUT:
{
  "id": "${h2_id}",
  "name": "${h2_name}",
  "items": [
    {"id": "${h2_id}1", "name": "Deep Dive into Amazon Aurora"},
    {"id": "${h2_id}2", "name": "Comparing RDS Engines"},
    {"id": "${h2_id}3", "name": "Managed Services for RDS"}
  ]
}
`;

const REGENERATION_PROMPT = (data: BlogData, feedback: string): string => `
ROLE: You are an expert Blog Outline editor. Your task is to regenerate a blog outline based on the original data, a previous outline, and specific user feedback.
INSTRUCTIONS:
1. Analyze the user's feedback carefully.
2. Modify the 'Previous Outline' to incorporate the feedback. This may involve adding, removing, reordering, or rephrasing H2s and H3s.
3. The output must be a valid JSON array of objects, following the same structure as the 'Previous Outline'. Do not add any other text or comments.

DETAILS:
- Title: "${data.title}"
- Primary Keyword: "${data.primaryKeyword}"
- User Feedback: "${feedback}"
- Previous Outline: ${JSON.stringify(data.outline, null, 2)}
`;

const FINAL_BLOG_PROMPT = (
	data: BlogData,
	outline: OutlineSection[]
): string => `
ROLE: You are an expert SEO Content Strategist and Writer. Your task is to generate a comprehensive, high-quality, and well-structured blog post that is optimized for search engines and provides excellent value to the reader.

BASE INSTRUCTIONS:
1.  **Adhere to Outline:** Follow the Approved Outline's H2 and H3 structure exactly.
2.  **Source Context:** Base the content on the knowledge you have, prioritizing any reference data context provided during outline generation.
3.  **Keywords:** Naturally integrate the Primary Keyword ("${
	data.primaryKeyword
}") and Secondary Keywords ("${data.secondaryKeywords.join(
	', '
)}"). The primary keyword should appear in the first paragraph.
4.  **Tone/Style:** Maintain a professional, educational, and non-promotional tone, consistent with the selected Brand Voice: "${
	data.brandVoice
}".

QUALITY & SEO GUIDELINES (CRITICAL):
1.  **Content Depth & Rich Formatting:**
    *   Provide in-depth, comprehensive information for each section. Do not write superficial content.
    *   **Crucially, use rich formatting to enhance readability. Use Markdown tables for comparisons or data, and use bullet points for lists wherever appropriate.** This is mandatory.
2.  **E-E-A-T (Experience, Expertise, Authoritativeness, Trust):**
    *   Write with authority and expertise.
    *   Demonstrate experience with practical examples or phrasing like "In practice..." or "A common challenge is...".
    *   Ensure all information is accurate and trustworthy.
3.  **Linking Strategy:**
    *   **Internal Links:** Seamlessly integrate the following internal links where the text naturally discusses the associated keyword. Format them as Markdown links: \`[keyword text](URL)\`. Do not just list them.
        ${
			data.interlinks.length > 0
				? data.interlinks
						.map(
							(l) =>
								`- Keyword: "${l.keyword}", URL: ${l.url}`
						)
						.join('\n')
				: '  (No internal links provided.)'
		}

DETAILS:
- Title: "${data.title}"
- Language: ${data.language}

APPROVED OUTLINE (Do NOT change this structure):
${JSON.stringify(outline, null, 2)}

OUTPUT: Generate the full blog content in Markdown format, starting with the Title (# ${
	data.title
}).
`;

const buildContentParts = async (
	prompt: string,
	data: BlogData
): Promise<Part[]> => {
	// Removed reference files since we're not using references in content generation
	const parts: Part[] = [{ text: prompt }];
	return parts;
};

export const generateTitles = async (
	data: BlogData,
	apiKey: string
): Promise<string[]> => {
	if (!apiKey) throw new Error('API Key is required.');
	const ai = new GoogleGenAI({ apiKey });

	const prompt = `
    ROLE: You are a creative copywriter specializing in blog titles.
    TASK: Generate 5 engaging and SEO-friendly blog titles based on the provided topic and keywords.
    INSTRUCTIONS:
    1. The titles should be catchy and relevant.
    2. Incorporate the primary keyword naturally.
    3. Output ONLY a clean JSON array of strings. Do not add any other text, pre-amble, or comments.

    DETAILS:
    - Topic: "${data.topic}"
    - Primary Keyword: "${data.primaryKeyword}"
    - Target Location: "${data.targetLocation}"

    EXAMPLE OUTPUT:
    ["10 AWS Database Services You Need to Know", "The Ultimate Guide to AWS Databases in ${data.targetLocation}", "Why ${data.primaryKeyword} is Crucial for Your Business"]
    `;

	const response: GenerateContentResponse = await retryWithBackoff(
		async () => {
			return await ai.models.generateContent({
				model: 'gemini-2.5-flash',
				contents: { parts: [{ text: prompt }] },
				config: {
					responseMimeType: 'application/json',
					responseSchema: {
						type: Type.ARRAY,
						items: { type: Type.STRING },
					},
				},
			});
		},
		{
			maxRetries: 3,
			initialDelay: 1000,
			onRetry: (attempt, delay) => {
				console.log(`   ⏳ Rate limit hit. Retrying in ${Math.ceil(delay / 1000)}s (attempt ${attempt}/3)...`);
			},
		}
	);

	const extractedText = extractTextFromResponse(response);
	const titles = cleanAndParseJson(extractedText);

	return titles;
};

/**
 * Search the web using Gemini's Google Search tool to find top 20 relevant titles
 * related to the user's query/topic
 */
export const searchWebForTitles = async (
	userQuery: string,
	apiKey: string
): Promise<string[]> => {
	if (!apiKey) throw new Error('API Key is required.');
	const ai = new GoogleGenAI({ apiKey });

	const prompt = `
	ROLE: You are a web research assistant specializing in finding relevant blog titles and articles.
	TASK: Search the web for the top 20 most relevant and popular blog titles/articles related to the user's query.
	INSTRUCTIONS:
	1. Use the Google Search tool to find real, existing blog titles and articles about the topic.
	2. Focus on titles that are actually published on the web, not generated ones.
	3. Return exactly 20 titles that are most relevant to the user's query.
	4. The titles should be diverse and cover different aspects of the topic.
	5. Output ONLY a clean JSON array of strings. Do not add any other text, pre-amble, or comments.

	USER QUERY: "${userQuery}"

	EXAMPLE OUTPUT:
	["10 Best Practices for Cloud Computing in 2024", "Understanding Cloud Architecture: A Complete Guide", "Cloud Computing Trends: What to Expect This Year"]
	`;

	const response: GenerateContentResponse = await retryWithBackoff(
		async () => {
			return await ai.models.generateContent({
				model: 'gemini-2.5-flash',
				contents: { parts: [{ text: prompt }] },
				config: {
					tools: [{ googleSearch: {} }],
					// Note: Cannot use responseMimeType with tools - must parse JSON from text
				},
			});
		},
		{
			maxRetries: 3,
			initialDelay: 1000,
			onRetry: (attempt, delay) => {
				console.log(`   ⏳ Rate limit hit. Retrying in ${Math.ceil(delay / 1000)}s (attempt ${attempt}/3)...`);
			},
		}
	);

	const extractedText = extractTextFromResponse(response);
	const titles = cleanAndParseJson(extractedText);

	// Ensure we return exactly 20 titles (or as many as we got, up to 20)
	return Array.isArray(titles) ? titles.slice(0, 20) : [];
};

/**
 * Filter meaningful keywords using LLM
 * Removes meaningless standalone keywords like "right", "about use", "choosing right", etc.
 */
export const filterMeaningfulKeywords = async (
	keywords: string[],
	userTopic: string,
	apiKey: string
): Promise<string[]> => {
	if (!apiKey) throw new Error('API Key is required.');
	if (!keywords || keywords.length === 0) return [];

	const ai = new GoogleGenAI({ apiKey });

	const prompt = `
ROLE: You are a keyword validation expert specializing in SEO and content marketing.
TASK: Filter out meaningless or incomplete keywords that don't make sense as standalone search terms.

INSTRUCTIONS:
1. Review each keyword in the list below.
2. Keep only keywords that are meaningful, complete, and make sense as standalone search terms.
3. Remove keywords that are:
   - Incomplete phrases (e.g., "right", "about use", "choosing right")
   - Generic words without context (e.g., "using", "guide", "best" when alone)
   - Fragments that don't convey clear intent
   - Stop words or filler words
4. Keep keywords that:
   - Are complete phrases with clear meaning
   - Relate to the user's topic: "${userTopic}"
   - Can be used as standalone search queries
   - Have semantic value

USER TOPIC: "${userTopic}"

KEYWORDS TO FILTER:
${keywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}

OUTPUT: Return ONLY a JSON array of strings containing the meaningful keywords. Do not include any other text, comments, or explanations.

EXAMPLE OUTPUT:
["aws database", "amazon rds", "database management"]
`;

	try {
		const response: GenerateContentResponse = await retryWithBackoff(
			async () => {
				return await ai.models.generateContent({
					model: 'gemini-2.5-flash',
					contents: { parts: [{ text: prompt }] },
					config: {
						responseMimeType: 'application/json',
						responseSchema: {
							type: Type.ARRAY,
							items: { type: Type.STRING },
						},
					},
				});
			},
			{
				maxRetries: 2,
				initialDelay: 1000,
				onRetry: (attempt, delay) => {
					console.log(`   ⏳ Retrying keyword filter in ${Math.ceil(delay / 1000)}s (attempt ${attempt}/2)...`);
				},
			}
		);

		const extractedText = extractTextFromResponse(response);
		const filteredKeywords = cleanAndParseJson(extractedText);

		return Array.isArray(filteredKeywords) ? filteredKeywords : [];
	} catch (err) {
		console.error('❌ Failed to filter keywords with LLM, using fallback filter:', err);
		// Fallback: simple heuristic filter
		return keywords.filter((kw) => {
			const words = kw.toLowerCase().split(/\s+/);
			// Filter out single generic words
			if (words.length === 1) {
				const genericWords = new Set(['right', 'using', 'guide', 'best', 'about', 'use', 'choosing', 'service']);
				return !genericWords.has(words[0]);
			}
			// Filter out incomplete phrases
			const incompletePatterns = ['about use', 'choosing right', 'right database'];
			return !incompletePatterns.some(pattern => kw.toLowerCase().includes(pattern));
		});
	}
};

export const generateOutline = async (
	data: BlogData,
	apiKey: string,
	feedback?: string
): Promise<OutlineSection[]> => {
	if (!apiKey) throw new Error('API Key is required.');
	const ai = new GoogleGenAI({ apiKey });

	if (feedback && data.outline.length > 0) {
		// Regeneration flow
		const prompt = REGENERATION_PROMPT(data, feedback);
		const contentParts = await buildContentParts(prompt, data);
		const response: GenerateContentResponse =
			await ai.models.generateContent({
				model: 'gemini-2.5-flash',
				contents: { parts: contentParts },
				config: {
					tools: [{ googleSearch: {} }], // Removed urlContext since we're not using references
				},
			});
		return cleanAndParseJson(extractTextFromResponse(response));
	}

	// Agentic flow for initial generation
	// 1. Planner Agent: Generate H2s
	const plannerPrompt = PLANNING_PROMPT(data);
	const plannerContentParts = await buildContentParts(plannerPrompt, data);
	const plannerResponse: GenerateContentResponse =
		await retryWithBackoff(
			async () => {
				return 			await ai.models.generateContent({
				model: 'gemini-2.5-flash',
				contents: { parts: plannerContentParts },
				config: {
					tools: [{ googleSearch: {} }], // Removed urlContext since we're not using references
				},
			});
			},
			{
				maxRetries: 3,
				initialDelay: 1000,
				onRetry: (attempt, delay) => {
					console.log(`   ⏳ Rate limit hit. Retrying in ${Math.ceil(delay / 1000)}s (attempt ${attempt}/3)...`);
				},
			}
		);
	const h2Plan: string[] = cleanAndParseJson(plannerResponse.text);

	if (!h2Plan || h2Plan.length === 0) {
		throw new Error(
			'Could not generate H2 headings based on the provided context.'
		);
	}

	// 2. Executor Agent: Generate H3s for each H2 in parallel
	const outlinePromises = h2Plan.map(async (h2Name, i) => {
		const h2Id = (i + 1).toString();
		const executorPrompt = EXECUTION_PROMPT(data, h2Name, h2Id);
		const executorContentParts = await buildContentParts(
			executorPrompt,
			data
		);

		const executorResponse: GenerateContentResponse =
			await retryWithBackoff(
				async () => {
					return await ai.models.generateContent({
						model: 'gemini-2.5-flash',
						contents: { parts: executorContentParts },
						config: {
							tools: [{ googleSearch: {} }], // Removed urlContext since we're not using references
						},
					});
				},
				{
					maxRetries: 3,
					initialDelay: 1000,
					onRetry: (attempt, delay) => {
						console.log(`   ⏳ Rate limit hit. Retrying in ${Math.ceil(delay / 1000)}s (attempt ${attempt}/3)...`);
					},
				}
			);

		return cleanAndParseJson(executorResponse.text) as OutlineSection;
	});

	const fullOutline = await Promise.all(outlinePromises);
	return fullOutline;
};

export const generateBlogPost = async (
	data: BlogData,
	outline: OutlineSection[],
	apiKey: string
): Promise<string> => {
	if (!apiKey) throw new Error('API Key is required.');
	const ai = new GoogleGenAI({ apiKey });

	const prompt = FINAL_BLOG_PROMPT(data, outline);
	const contentParts = await buildContentParts(prompt, data);

	const responseStream = await ai.models.generateContentStream({
		model: 'gemini-2.5-flash',
		contents: { parts: contentParts },
		config: {
			tools: [{ googleSearch: {} }], // Removed urlContext since we're not using references
		},
	});

	let blogContent = '';
	for await (const chunk of responseStream) {
		blogContent += chunk.text;
	}
	return blogContent;
};
