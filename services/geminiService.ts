import {
	GoogleGenAI,
	Type,
	GenerateContentResponse,
	Part,
} from '@google/genai';
import OpenAI from 'openai';
import { BlogData, OutlineSection } from '../types';
import { retryWithBackoff } from '../utils/retryWithBackoff';
import { searchGoogleForUrls } from './googleSearchService';
import * as keywordTool from './keywordService';

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

export const __internal_extractFirstJsonValue = (rawText: string): string | null => {
	if (!rawText) return null;

	const text = String(rawText);
	const start = Math.min(
		...['[', '{']
			.map((c) => text.indexOf(c))
			.filter((i) => i >= 0)
	);
	if (!Number.isFinite(start) || start < 0) return null;

	const stack: string[] = [];
	let inString = false;
	let escape = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];

		if (inString) {
			if (escape) {
				escape = false;
				continue;
			}
			if (ch === '\\') {
				escape = true;
				continue;
			}
			if (ch === '"') {
				inString = false;
			}
			continue;
		}

		if (ch === '"') {
			inString = true;
			continue;
		}

		if (ch === '{' || ch === '[') {
			stack.push(ch);
			continue;
		}
		if (ch === '}' || ch === ']') {
			const last = stack.pop();
			if (!last) return null;
			if (last === '{' && ch !== '}') return null;
			if (last === '[' && ch !== ']') return null;
			if (stack.length === 0) {
				return text.slice(start, i + 1);
			}
		}
	}

	return null;
};

export const __internal_cleanAndParseJson = (text: string): any => {
	const raw = String(text ?? '');
	const cleanedText = raw
		.replace(/^[\s\uFEFF\xA0]+/, '')
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/```\s*$/i, '')
		.trim();

	try {
		return JSON.parse(cleanedText);
	} catch {
		const extracted =
			__internal_extractFirstJsonValue(cleanedText) ||
			__internal_extractFirstJsonValue(raw);
		if (extracted) {
			try {
				return JSON.parse(extracted);
			} catch {
				// fall through
			}
		}

		console.error('Failed to parse JSON from model response:', text);
		throw new Error(
			`Model returned invalid JSON. Response text: "${text}"`
		);
	}
};

const cleanAndParseJson = (text: string): any => {
	return __internal_cleanAndParseJson(text);
};

/**
 * Use Gemini to sort candidate keywords by relevance to the topic.
 * Returns an ordered array of keyword texts.
 */
export const rankKeywordsByLLM = async (
	topic: string,
	keywords: string[],
	apiKey: string
): Promise<string[]> => {
	if (!apiKey) {
		console.warn(
			'   ⚠️ [LLM RANKING] API key missing – skipping LLM sorting'
		);
		return [];
	}
	if (!keywords || keywords.length === 0) {
		return [];
	}

	const ai = new GoogleGenAI({ apiKey });
	const prompt = `
ROLE: You are a search-aware SEO assistant that understands user intent.
TASK: Given a target topic and a list of keyword candidates, sort the keywords so that the most relevant ones appear first.
PRIORITIZE: 1) Fresh relevance to "${topic}", 2) Intent alignment, 3) Actionable phrasing.
OUTPUT: A JSON array of the keyword texts in the order you recommend. Do not add any prose.

TOPIC: "${topic}"
KEYWORDS:
${keywords.map((kw, index) => `${index + 1}. ${kw}`).join('\n')}
`;

	try {
		const response: GenerateContentResponse = await retryWithBackoff(
			async () => {
				return await ai.models.generateContent({
					model: 'gemini-2.5-flash',
					contents: { parts: [{ text: prompt }] },
					config: {
						tools: [{ googleSearch: {} }],
					},
				});
			},
			{
				maxRetries: 2,
				initialDelay: 800,
			}
		);

		const extractedText = extractTextFromResponse(response);
		const parsed = cleanAndParseJson(extractedText);
		if (Array.isArray(parsed)) {
			return parsed
				.map((item) => (typeof item === 'string' ? item : ''))
				.filter(Boolean);
		}
	} catch (err) {
		console.warn(
			'   ⚠️ [LLM RANKING] Failed to rank keywords via Gemini:',
			err
		);
	}

	return [];
};

const PLANNING_PROMPT = (data: BlogData): string => {
	// Extract meaningful keywords from title and topic
	const extractKeywords = (text: string): string[] => {
		if (!text) return [];
		const stopWords = new Set([
			'the',
			'a',
			'an',
			'and',
			'or',
			'but',
			'in',
			'on',
			'at',
			'to',
			'for',
			'of',
			'with',
			'by',
			'is',
			'are',
			'was',
			'were',
			'be',
			'been',
			'being',
			'have',
			'has',
			'had',
			'do',
			'does',
			'did',
			'will',
			'would',
			'should',
			'could',
			'may',
			'might',
			'must',
			'can',
			'its',
			'it',
			'this',
			'that',
			'what',
			'how',
			'when',
			'where',
			'why',
			'your',
			'you',
			'their',
			'they',
			'them',
			'these',
			'those',
		]);

		return text
			.toLowerCase()
			.split(/\W+/)
			.filter((w) => w.length >= 3)
			.filter((w) => !stopWords.has(w));
	};

	const titleKeywords = extractKeywords(data.title || '');
	const topicKeywords = extractKeywords(data.topic || '');
	const allKeywords = [...new Set([...titleKeywords, ...topicKeywords])];
	const keywordContext =
		allKeywords.length > 0
			? `\n- Keywords from Title & Topic: ${allKeywords.join(', ')}`
			: '';

	return `
ROLE: Blog Outline Planner. Generate 5-10 H2 headings for a blog post.

PRIORITY (in order):
1. User Topic: "${data.topic || 'N/A'}" - PRIMARY focus
2. Title: "${data.title || 'N/A'}" - Defines scope
3. Keywords: ${data.primaryKeyword || 'N/A'}${
		data.secondaryKeywords.length > 0
			? `, ${data.secondaryKeywords.join(', ')}`
			: ''
	}${keywordContext}

REQUIREMENTS:
- Sections must flow logically (each builds on previous)
- Incorporate keywords naturally into H2 headings
- Use Google Search if no references provided
- Output ONLY JSON array of H2 strings

STRUCTURE (MANDATORY ORDER - MUST FOLLOW):
1. Introduction (strong opening that sets context and captures attention)
2. Main topics (title + topic keywords) - 3-7 sections covering core content
3. Conclusion (MANDATORY - must be the second-to-last section, wrap up key points and summarize main takeaways)
4. Frequently Asked Questions (FAQs) (MANDATORY - must be the LAST section, include 5-7 questions related to the topic)

CRITICAL: The outline MUST end with:
- Second-to-last: "Conclusion" or "Summary" or similar conclusion section
- Last: "Frequently Asked Questions" or "FAQs" or "Common Questions" section

NOTE: The blog will automatically include:
- TL;DR section at the very beginning (3-5 lines summarizing key takeaways)

DETAILS:
- Topic: "${data.topic || 'N/A'}"
- Title: "${data.title || 'N/A'}"
- Primary: "${data.primaryKeyword || 'N/A'}"
- Secondary: ${
		data.secondaryKeywords.length > 0
			? data.secondaryKeywords.join(', ')
			: 'None'
	}
- Language: ${data.language}
- References: ${data.referenceFiles.length} files, ${
		data.referenceUrls.length
	} URLs
${
	data.referenceUrls.length > 0
		? `- URLs:\n${data.referenceUrls.map((u) => `   ${u}`).join('\n')}`
		: ''
}
`;
};

const EXECUTION_PROMPT = (
	data: BlogData,
	h2_name: string,
	h2_id: string,
	previousH2?: string,
	nextH2?: string
): string => {
	const contextSection =
		previousH2 || nextH2
			? `
CONTEXT FOR CONTINUITY:
${
	previousH2
		? `- Previous Section: "${previousH2}" (this section should build upon or relate to it)`
		: ''
}
${
	nextH2
		? `- Next Section: "${nextH2}" (this section should lead into it)`
		: ''
}
- Ensure H3 subheadings create a smooth transition between sections`
			: '';

	return `
ROLE: Blog Section Detail Agent. Generate 3-5 H3 subheadings for H2: "${h2_name}"

PRIORITY:
- Topic: "${data.topic || 'N/A'}"
- Title: "${data.title || 'N/A'}"
- Keywords: ${data.primaryKeyword || 'N/A'}${
		data.secondaryKeywords.length > 0
			? `, ${data.secondaryKeywords.join(', ')}`
			: ''
	}${contextSection}

REQUIREMENTS:
- H3s must relate to each other and flow logically
- Incorporate keywords naturally
- Use Google Search if no references
- Output ONLY JSON object (no other text)

DETAILS:
- H2: "${h2_name}"
- References: ${data.referenceFiles.length} files, ${
		data.referenceUrls.length
	} URLs
${
	data.referenceUrls.length > 0
		? `- URLs:\n${data.referenceUrls.map((u) => `   ${u}`).join('\n')}`
		: ''
}

OUTPUT FORMAT:
{
  "id": "${h2_id}",
  "name": "${h2_name}",
  "items": [
    {"id": "${h2_id}1", "name": "H3 subheading 1"},
    {"id": "${h2_id}2", "name": "H3 subheading 2"},
    {"id": "${h2_id}3", "name": "H3 subheading 3"}
  ]
}
`;
};

const REGENERATION_PROMPT = (data: BlogData, feedback: string): string => `
ROLE: You are an expert Blog Outline editor. Your task is to regenerate a blog outline based on the original data, a previous outline, and specific user feedback.
INSTRUCTIONS:
1. Analyze the user's feedback carefully.
2. Modify the 'Previous Outline' to incorporate the feedback. This may involve adding, removing, reordering, or rephrasing H2s and H3s.
3. The output must be a valid JSON array of objects, following the same structure as the 'Previous Outline'. Do not add any other text or comments.
4. CRITICAL: Ensure the outline ALWAYS ends with:
   - Second-to-last section: "Conclusion" or "Summary" (wrap up key points)
   - Last section: "Frequently Asked Questions" or "FAQs" or "Common Questions" (5-7 questions related to the topic)
   - If these sections are missing, ADD them at the end
   - If they exist but are not in the correct position, MOVE them to the end

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
ROLE: You are an expert SEO Content Strategist and Writer. Your task is to generate original, valuable, and SEO-friendly blog content that provides excellent value to readers.

MANDATORY STRUCTURE (follow this exact order):
1. **TL;DR Section** (MUST be first, before title)
   - Write a concise 3-5 line summary of key takeaways
   - Use format: "## TL;DR" as H2 heading
   - Make it scannable and informative

2. **Title** (H1)
   - Use: # ${data.title}

3. **Introduction** (First H2 section)
   - Strong opening that sets context and captures attention
   - Include the primary keyword naturally in the first paragraph
   - Set the stage for what readers will learn

4. **Main Content** (Follow outline H2/H3 structure exactly)
   - Use clear H2 and H3 headings for structure
   - Each section should flow logically into the next

5. **FAQs Section** (MUST be last, after all outline sections)
   - Generate 5-7 frequently asked questions related to the topic
   - Use format: "## Frequently Asked Questions (FAQs)" as H2 heading
   - Each FAQ should have a clear question (H3) and comprehensive answer
   - Questions should cover common concerns, clarifications, and related topics

CONTENT QUALITY GUIDELINES (CRITICAL):
1. **Originality & Value:**
   - Write original, valuable content - avoid rephrasing generic ideas
   - Focus on delivering clarity and depth
   - Avoid fluff, keyword stuffing, and overly promotional language

2. **Tone & Readability:**
   - Write in a conversational, human-friendly tone to improve readability and engagement
   - Maintain a professional, educational, and non-promotional tone
   - Consistent with Brand Voice: "${data.brandVoice || 'Professional'}"

3. **Content Depth:**
   - Aim for 800+ words unless the topic is very narrow or highly specific
   - Provide in-depth, comprehensive information for each section
   - Do not write superficial content

4. **Rich Formatting:**
   - Use Markdown tables for comparisons or data
   - Use bullet points and numbered lists wherever appropriate
   - Use bold/italic for emphasis when needed
   - Maintain consistent formatting and flow

5. **Real Examples & Credibility:**
   - Include real examples, research-backed insights, case studies, or statistics wherever relevant
   - Use phrasing like "In practice...", "A common challenge is...", "Research shows..."
   - Demonstrate experience and expertise

6. **SEO Optimization:**
   - Naturally integrate Primary Keyword ("${
		data.primaryKeyword || ''
   }") throughout
   - Naturally integrate Secondary Keywords ("${
		data.secondaryKeywords.join(', ') || ''
   }")
   - Primary keyword should appear in the first paragraph
   - Keywords should feel natural, not forced

7. **E-E-A-T (Experience, Expertise, Authoritativeness, Trust):**
   - Write with authority and expertise
   - Ensure all information is accurate and trustworthy
   - Demonstrate practical knowledge

8. **Linking Strategy:**
   - **Internal Links:** Seamlessly integrate the following internal links where the text naturally discusses the associated keyword. Format them as Markdown links: \`[keyword text](URL)\`. Do not just list them.
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
- Topic: "${data.topic || ''}"
- Language: ${data.language || 'English'}

APPROVED OUTLINE (Follow this H2/H3 structure exactly for main content):
${JSON.stringify(outline, null, 2)}

OUTPUT FORMAT:
- Start with TL;DR section (## TL;DR)
- Then Title (# ${data.title})
- Then Introduction (first H2 from outline)
- Then all other outline sections in order
- End with FAQs section (## Frequently Asked Questions (FAQs))
- Use proper Markdown formatting throughout
- Ensure the blog feels structured, easy to read, and maintains consistent flow
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
	apiKey: string,
	feedback?: string,
	referenceTitles?: string[]
): Promise<string[]> => {
	if (!apiKey) throw new Error('API Key is required.');
	const ai = new GoogleGenAI({ apiKey });

	const feedbackSection = feedback
		? `
    USER FEEDBACK (IMPORTANT - incorporate this into the new titles):
    "${feedback}"
    
    Please generate NEW titles that address this feedback. Make sure the titles are different from previous attempts and incorporate the user's suggestions.`
		: '';

	const secondaryKeywordsSection =
		data.secondaryKeywords && data.secondaryKeywords.length > 0
			? `
    - Secondary Keywords: ${data.secondaryKeywords.join(', ')}
    - MANDATORY: At least one secondary keyword MUST be included in each title`
			: '';

	const referenceTitlesSection =
		referenceTitles && referenceTitles.length > 0
			? `
    
    REFERENCE TITLES (from web search - use these as inspiration for style and structure):
    ${referenceTitles
		.map((title, idx) => `${idx + 1}. ${title}`)
		.join('\n    ')}
    
    IMPORTANT: Study these reference titles to understand:
    - How they structure titles
    - What makes them engaging
    - How they incorporate keywords
    - Their tone and style
    Use these as inspiration but create ORIGINAL titles, don't copy them.`
			: '';

	const userTopic = data.topic || '';
	const primaryKeyword = data.primaryKeyword || '';

	if (!primaryKeyword) {
		throw new Error('Primary keyword is required for title generation');
	}

	const prompt = `
    ROLE: You are a creative copywriter specializing in blog titles.
    TASK: Generate 8-10 engaging and SEO-friendly blog titles based on the provided topic and keywords.${
		feedback
			? ' This is a regeneration request - please create NEW titles that incorporate the user feedback.'
			: ''
    }
    
    MANDATORY REQUIREMENTS (ALL must be met):
    1. ✨ USER TOPIC INTENT: The title MUST reflect the user's topic intent: "${userTopic}"
    2. 🔑 PRIMARY KEYWORD: The primary keyword "${primaryKeyword}" MUST be included in EVERY title
    3. 🔑 SECONDARY KEYWORDS: At least one secondary keyword MUST be included in each title${
		data.secondaryKeywords && data.secondaryKeywords.length > 0
			? ` (available: ${data.secondaryKeywords.join(', ')})`
			: ''
    }
    4. 📚 REFERENCE TITLES: Use the reference titles provided as inspiration for style, structure, and engagement techniques${
		referenceTitles && referenceTitles.length > 0
			? ' (see reference titles below)'
			: ''
    }
    5. 🎯 VARIETY: Generate different types of titles:
       - Clickbait style (e.g., "You Won't Believe...", "The Shocking Truth About...")
       - How-to guides (e.g., "How to...", "Complete Guide to...")
       - List-based (e.g., "10 Ways...", "Top 5...")
       - Question-based (e.g., "What is...?", "Why Does...?")
       - Comparison/versus (e.g., "...vs...", "The Difference Between...")
       - Ultimate guides (e.g., "The Ultimate Guide to...", "Everything You Need to Know About...")
    6. 🎯 SEO OPTIMIZATION: Titles should be 50-70 characters for optimal SEO
    7. 🎯 ENGAGEMENT: Make titles compelling, click-worthy, and relevant to the target audience in ${
		data.targetLocation || 'United States'
    }
    ${feedback ? '8. Address the user feedback in the new titles.' : ''}
    
    DETAILS:
    - User Topic: "${userTopic}"
    - Primary Keyword: "${primaryKeyword}"${secondaryKeywordsSection}
    - Target Location: "${
		data.targetLocation || 'United States'
    }"${referenceTitlesSection}${feedbackSection}

    OUTPUT FORMAT:
    - Output ONLY a clean JSON array of strings
    - Do not add any other text, pre-amble, or comments
    - Generate 8-10 titles with variety in style
    - Each title MUST include the primary keyword "${primaryKeyword}"
    ${
		data.secondaryKeywords && data.secondaryKeywords.length > 0
			? `- Each title MUST include at least one secondary keyword from: ${data.secondaryKeywords.join(
					', '
			  )}`
			: ''
    }

    EXAMPLE OUTPUT:
    ["10 ${primaryKeyword} Strategies You Need to Know in 2024", "The Ultimate Guide to ${primaryKeyword} for Beginners", "Why ${primaryKeyword} is Revolutionizing ${userTopic}", "How to Master ${primaryKeyword}: A Complete Tutorial", "The Shocking Truth About ${primaryKeyword} and ${userTopic}"]
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
				console.log(
					`   ⏳ Rate limit hit. Retrying in ${Math.ceil(
						delay / 1000
					)}s (attempt ${attempt}/3)...`
				);
			},
		}
	);

	const extractedText = extractTextFromResponse(response);
	const titles = cleanAndParseJson(extractedText);

	// ✨ VALIDATION: Ensure all titles contain the primary keyword
	if (!Array.isArray(titles)) {
		console.warn(
			'⚠️  [TITLE GENERATION] Invalid response format, returning empty array'
		);
		return [];
	}

	const primaryKeywordLower = primaryKeyword.toLowerCase();
	// Split primary keyword into words for flexible matching
	const primaryKeywordWords = primaryKeywordLower
		.split(/\s+/)
		.filter((w) => w.length > 0);

	const validatedTitles: string[] = [];
	const filteredTitles: string[] = [];

	titles.forEach((title: string) => {
		if (!title || typeof title !== 'string') {
			filteredTitles.push(title || '[invalid]');
			return;
		}

		const titleLower = title.toLowerCase();

		// First check: Exact phrase match (preferred)
		if (titleLower.includes(primaryKeywordLower)) {
			validatedTitles.push(title);
			return;
		}

		// Second check: All words from primary keyword are present (flexible matching)
		// This handles cases like "AI in Marketing" vs "AI Marketing" or "Marketing AI"
		const allWordsPresent = primaryKeywordWords.every((word) =>
			titleLower.includes(word)
		);

		if (allWordsPresent) {
			validatedTitles.push(title);
		} else {
			filteredTitles.push(title);
		}
	});

	if (filteredTitles.length > 0) {
		console.warn(
			`   ⚠️  Filtered out ${filteredTitles.length} title(s) that didn't contain primary keyword "${primaryKeyword}"`
		);
		// Log filtered titles for debugging (first 3 only)
		filteredTitles.slice(0, 3).forEach((title, idx) => {
			console.warn(`      ${idx + 1}. "${title}"`);
		});
		if (filteredTitles.length > 3) {
			console.warn(
				`      ... and ${filteredTitles.length - 3} more`
			);
		}
	}

	// If we have secondary keywords, also validate that titles include at least one
	if (data.secondaryKeywords && data.secondaryKeywords.length > 0) {
		const secondaryKeywordsLower = data.secondaryKeywords.map((kw) =>
			kw.toLowerCase()
		);
		const titlesWithSecondary = validatedTitles.filter(
			(title: string) => {
				const titleLower = title.toLowerCase();
				return secondaryKeywordsLower.some((kw) =>
					titleLower.includes(kw)
				);
			}
		);

		if (titlesWithSecondary.length > 0) {
			// Prioritize titles with secondary keywords
			const titlesWithoutSecondary = validatedTitles.filter(
				(title: string) => !titlesWithSecondary.includes(title)
			);
			const finalTitles = [
				...titlesWithSecondary,
				...titlesWithoutSecondary,
			];

			console.log(
				`   ✅ [TITLE VALIDATION] ${finalTitles.length} titles passed validation (${titlesWithSecondary.length} with secondary keywords, ${titlesWithoutSecondary.length} without)`
			);

			return finalTitles;
		} else {
			console.warn(
				`   ⚠️  [TITLE VALIDATION] No titles contain secondary keywords, but returning ${validatedTitles.length} titles with primary keyword only`
			);
		}
	}

	console.log(
		`   ✅ [TITLE VALIDATION] ${validatedTitles.length} titles passed validation (all contain primary keyword "${primaryKeyword}")`
	);

	return validatedTitles;
};

/**
 * Filter and refine keywords based on user feedback
 * Used when regenerating keywords with specific user requirements
 * This function can both filter existing keywords AND generate new variations based on feedback
 */
export const filterKeywordsWithFeedback = async (
	keywords: Array<{
		text: string;
		volume: number;
		difficulty: number;
		score?: number;
	}>,
	topic: string,
	feedback: string,
	apiKey: string
): Promise<
	Array<{
		text: string;
		volume: number;
		difficulty: number;
		score?: number;
	}>
> => {
	if (!apiKey) throw new Error('API Key is required.');
	const ai = new GoogleGenAI({ apiKey });

	const keywordsList = keywords
		.slice(0, 50)
		.map(
			(kw, idx) =>
				`${idx + 1}. "${kw.text}" (Volume: ${
					kw.volume
				}, Difficulty: ${kw.difficulty})`
		)
		.join('\n');

	const prompt = `
ROLE: You are a keyword research expert specializing in SEO and content marketing.
TASK: Generate NEW and DIFFERENT keywords based on user feedback. This is a REGENERATION request - the user wants different keywords, not just filtered versions of the same ones.

CONTEXT:
- Topic: "${topic}"
- User Feedback: "${feedback}"
- Previous Keywords (shown for reference, but you should generate DIFFERENT ones):
${keywordsList}

INSTRUCTIONS:
1. Analyze the user feedback carefully. The user wants DIFFERENT keywords that address their feedback.
2. Generate NEW keyword variations that:
   - Are relevant to the topic "${topic}"
   - Address the specific feedback: "${feedback}"
   - Are DIFFERENT from the previous keywords shown above
   - Match the intent described in the feedback (e.g., if feedback says "more technical", generate technical keywords; if "long-tail", generate longer phrases)
3. Return a JSON array of NEW keyword objects
4. Each keyword should have: text, volume (estimate 500-5000), difficulty (estimate 0.3-0.8)
5. Generate at least 25-30 keywords to ensure variety
6. Make sure keywords are DIFFERENT from the previous list - don't just return the same keywords
7. Output ONLY a clean JSON array. Do not add any other text or comments.

EXAMPLES:
- If feedback is "more technical": Generate technical terms, jargon, specific technologies
- If feedback is "long-tail keywords": Generate longer, more specific phrases (3-5 words)
- If feedback is "focus on beginners": Generate beginner-friendly, tutorial-style keywords
- If feedback is "higher volume": Generate more popular, mainstream keywords

OUTPUT FORMAT:
[
  {"text": "new keyword 1", "volume": 1000, "difficulty": 0.5},
  {"text": "new keyword 2", "volume": 2000, "difficulty": 0.6}
]

CRITICAL: Generate NEW keywords that are DIFFERENT from the previous list. The user wants fresh keywords that match their feedback.
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
							items: {
								type: Type.OBJECT,
								properties: {
									text: {
										type: Type.STRING,
									},
									volume: {
										type: Type.NUMBER,
									},
									difficulty: {
										type: Type.NUMBER,
									},
								},
								required: [
									'text',
									'volume',
									'difficulty',
								],
							},
						},
					},
				});
			},
			{
				maxRetries: 3,
				initialDelay: 1000,
			}
		);

		const extractedText = extractTextFromResponse(response);
		const refinedKeywords = cleanAndParseJson(extractedText);

		// Map back to original format, preserving scores if available
		return refinedKeywords.map((kw: any) => {
			// Find original keyword to preserve volume/difficulty if text matches
			const original = keywords.find(
				(k) => k.text.toLowerCase() === kw.text.toLowerCase()
			);
			return {
				text: kw.text,
				volume: kw.volume || original?.volume || 0,
				difficulty:
					kw.difficulty || original?.difficulty || 0.5,
				score: original?.score,
			};
		});
	} catch (error) {
		console.error('❌ [FILTER KEYWORDS WITH FEEDBACK] Error:', error);
		// Return original keywords if filtering fails
		return keywords;
	}
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
				console.log(
					`   ⏳ Rate limit hit. Retrying in ${Math.ceil(
						delay / 1000
					)}s (attempt ${attempt}/3)...`
				);
			},
		}
	);

	const extractedText = extractTextFromResponse(response);
	const titles = cleanAndParseJson(extractedText);

	// Ensure we return exactly 20 titles (or as many as we got, up to 20)
	return Array.isArray(titles) ? titles.slice(0, 20) : [];
};

/**
 * Extract keywords from URLs using Gemini's urlContext tool
 * Analyzes URL content and extracts relevant SEO keywords with estimated volumes and difficulty
 *
 * @param urls Array of URLs to analyze
 * @param topic User's topic for context
 * @param apiKey Gemini API key
 * @returns Array of keywords with text, volume, and difficulty
 */
export const extractKeywordsFromUrls = async (
	urls: string[],
	topic: string,
	apiKey: string
): Promise<Array<{ text: string; volume: number; difficulty: number }>> => {
	if (!apiKey) throw new Error('API Key is required.');
	if (!urls || urls.length === 0) return [];

	const ai = new GoogleGenAI({ apiKey });

	const prompt = `
ROLE: You are an SEO keyword research expert specializing in extracting relevant keywords from web content.
TASK: Analyze the provided URLs and extract the most relevant SEO keywords related to the topic "${topic}".

INSTRUCTIONS:
1. Use the urlContext tool to analyze the content of each URL provided.
2. Extract 20 highly relevant keywords from EACH URL (total: ${
		urls.length
	} URLs × 20 keywords = ${urls.length * 20} keywords).
3. Focus on keywords that:
   - Are directly related to the topic "${topic}"
   - Have clear search intent
   - Are 1-4 words long (prefer 2-3 word phrases)
   - Would be valuable for SEO and content optimization
4. For each keyword, estimate:
   - volume: Monthly search volume (estimate between 100-50000 based on keyword popularity)
   - difficulty: SEO difficulty score (0.0 to 1.0, where 0 is easy and 1 is very hard)
5. Prioritize:
   - Long-tail keywords (2-4 words) over single words
   - Specific, actionable keywords over generic terms
   - Keywords with commercial or informational intent
6. Output ONLY a clean JSON array of keyword objects. Do not add any other text or comments.

TOPIC: "${topic}"

URLs TO ANALYZE:
${urls.map((url, i) => `${i + 1}. ${url}`).join('\n')}

OUTPUT FORMAT:
[
  {"text": "keyword phrase 1", "volume": 5000, "difficulty": 0.45},
  {"text": "keyword phrase 2", "volume": 2000, "difficulty": 0.62},
  {"text": "keyword phrase 3", "volume": 8000, "difficulty": 0.38}
]

CRITICAL: Extract exactly 20 keywords per URL. Make sure keywords are relevant to "${topic}" and have realistic volume/difficulty estimates.
`;

	try {
		const response: GenerateContentResponse = await retryWithBackoff(
			async () => {
				return await ai.models.generateContent({
					model: 'gemini-2.5-flash',
					contents: { parts: [{ text: prompt }] },
					config: {
						tools: [
							{ googleSearch: {} },
							{ urlContext: {} },
						],
						// Note: Cannot use responseMimeType with tools - must parse JSON from text
					},
				});
			},
			{
				maxRetries: 3,
				initialDelay: 1000,
				onRetry: (attempt, delay) => {
					console.log(
						`   ⏳ Rate limit hit. Retrying in ${Math.ceil(
							delay / 1000
						)}s (attempt ${attempt}/3)...`
					);
				},
			}
		);

		const extractedText = extractTextFromResponse(response);
		const keywords = cleanAndParseJson(extractedText);

		// Validate and return keywords
		if (Array.isArray(keywords)) {
			return keywords
				.filter(
					(kw: any) =>
						kw.text &&
						typeof kw.text === 'string' &&
						kw.text.trim().length > 0 &&
						typeof kw.volume === 'number' &&
						typeof kw.difficulty === 'number'
				)
				.map((kw: any) => ({
					text: kw.text.trim(),
					volume: Math.max(0, Math.min(100000, kw.volume)), // Clamp volume
					difficulty: Math.max(
						0,
						Math.min(1, kw.difficulty)
					), // Clamp difficulty to 0-1
				}));
		}

		return [];
	} catch (error) {
		console.error('❌ [EXTRACT KEYWORDS FROM URLS] Error:', error);

		// If the error looks like a schema mismatch for the batch `urls` field, attempt
		// per-URL urlContext calls (some GenAI tool schemas expect a single `url` per tool).
		const isUrlsFieldError = String(error).includes("Unknown name \"urls\"") || (error && (error as any).status === 400);
		if (isUrlsFieldError) {
			console.warn('   ⚠️ [EXTRACT KEYWORDS FROM URLS] Batch urlContext payload failed; retrying in small batches (prompt-embedded URLs)');
			const perBatchResults: any[] = [];
			// retry in small batches to avoid potential per-request size issues
			const batchSize = 5;
			for (let i = 0; i < urls.length; i += batchSize) {
				const slice = urls.slice(i, i + batchSize);
				try {
					const batchPrompt = prompt.replace(/URLs TO ANALYZE:[\s\S]*?OUTPUT FORMAT:/, `URLs TO ANALYZE:\n${slice.map((u, idx) => `${idx + 1}. ${u}`).join('\n')}\n\nOUTPUT FORMAT:`);
					const resp: GenerateContentResponse = await retryWithBackoff(
						async () => {
							return await ai.models.generateContent({
								model: 'gemini-2.5-flash',
								contents: { parts: [{ text: batchPrompt }] },
								config: {
									tools: [
										{ googleSearch: {} },
										{ urlContext: {} },
									],
								},
							});
						},
						{ maxRetries: 2, initialDelay: 800 }
					);
					const text = extractTextFromResponse(resp);
					const kws = cleanAndParseJson(text);
					if (Array.isArray(kws)) perBatchResults.push(...kws);

					// log url_context_metadata if present for diagnostics
					try {
						const meta = (resp as any).candidates?.[0]?.url_context_metadata;
						if (meta && meta.url_metadata) {
							console.log('   ℹ️ url_context_metadata for batch:', meta.url_metadata);
						}
					} catch (metaErr) {
						// ignore
					}
				} catch (perErr) {
					console.warn('   ⚠️ per-batch urlContext request failed for', slice, perErr);
				}
			}
			if (perBatchResults.length > 0) {
				const mapped = perBatchResults
					.filter((kw: any) => kw.text && typeof kw.volume === 'number' && typeof kw.difficulty === 'number')
					.map((kw: any) => ({ text: kw.text.trim(), volume: Math.max(0, Math.min(100000, kw.volume)), difficulty: Math.max(0, Math.min(1, kw.difficulty)) }));
				console.log(`   ✅ [EXTRACT KEYWORDS FROM URLS] Per-batch urlContext produced ${mapped.length} keywords`);
				return mapped;
			}
		}

		// FALLBACK: If urlContext/tool payload fails (or per-URL retries produced nothing),
		// try a titles-based extraction path so the caller still receives usable keywords.
		try {
			console.log('   ⚠️ [EXTRACT KEYWORDS FROM URLS] Falling back to titles-based extraction');
			// Use searchWebForTitles to get representative titles for the topic
			const titles = await searchWebForTitles(topic, apiKey);
			if (titles && titles.length > 0) {
				let extracted: string[] = [];
				if ((keywordTool as any).extractKeywordsFromTitles) {
					extracted = (keywordTool as any).extractKeywordsFromTitles(titles, Math.max(20, urls.length * 5)) || [];
				} else if ((keywordTool as any).extractSeedsFromTitle) {
					extracted = titles.map((t) => (keywordTool as any).extractSeedsFromTitle(t, 3)).flat().filter(Boolean) as string[];
				}
				if (extracted && extracted.length > 0) {
					// Map to expected shape with heuristic volume/difficulty estimates
					const mapped = extracted.map((t, i) => ({ text: t, volume: 1000 - Math.min(900, i * 10), difficulty: 0.5 }));
					console.log(`   ✅ [EXTRACT KEYWORDS FROM URLS] Fallback produced ${mapped.length} keywords from titles`);
					return mapped;
				}
			}
		} catch (fbErr) {
			console.warn('   ⚠️ [EXTRACT KEYWORDS FROM URLS] Titles-based fallback failed:', fbErr);
		}

		// TODO: If titles-based extraction is insufficient, implement an OpenAI-based fallback
		// that either fetches page HTML server-side and asks the LLM to extract keywords from content,
		// or prompts OpenAI to suggest keywords for the topic when web tools are unavailable.

		return [];
	}
};

/**
 * Search web for top 5 URLs related to user topic
 * Uses OpenAI with Google Custom Search to get recent, valid URLs with sources
 *
 * @param userQuery The search query/topic
 * @param apiKey OpenAI API key (or Gemini API key for fallback)
 * @returns Array of 5 URLs
 */
export const searchWebForUrls = async (
	userQuery: string,
	apiKey: string
): Promise<string[]> => {
	if (!apiKey) throw new Error('API Key is required.');

	// COMMENTED OUT: Perplexity API implementation
	/*
	// Try Perplexity API first
	const perplexityApiKey = process.env.PERPLEXITY_API_KEY;

	if (perplexityApiKey) {
		console.log('   🔍 Using Perplexity API search...');

		try {
			const response = await fetch(
				'https://api.perplexity.ai/search',
				{
					method: 'POST',
					headers: {
						Authorization: `Bearer ${perplexityApiKey}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						query: userQuery,
						max_results: 15, // Get more results to filter down to 5
						search_recency_filter: 'month', // Get recent results (last month)
						// Exclude unwanted domains
						search_domain_filter: [], // Empty means no domain restrictions
					}),
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`Perplexity API failed: ${response.status} ${
						response.statusText
					}. ${errorText.substring(0, 200)}`
				);
			}

			const data = await response.json();

			// Extract URLs from search results
			const urls: string[] = [];

			if (data.results && Array.isArray(data.results)) {
				for (const result of data.results) {
					if (
						result.url &&
						typeof result.url === 'string'
					) {
						urls.push(result.url);
					}
				}
			}

			// Domains to exclude
			const excludedDomains = [
				'cloud.google.com',
				'ai.google.dev',
				'console.cloud.google.com',
				'developers.google.com',
				'youtube.com',
				'youtu.be',
				'wikipedia.org',
				'quora.com',
			];

			// Filter and validate URLs
			const seenUrls = new Set<string>();
			const validUrls = urls
				.filter((url: string) => {
					if (!url || typeof url !== 'string') return false;

					// Deduplicate
					const normalizedUrl = url.trim().toLowerCase();
					if (seenUrls.has(normalizedUrl)) return false;
					seenUrls.add(normalizedUrl);

					try {
						const urlObj = new URL(url);
						const hostname =
							urlObj.hostname.toLowerCase();

						// Exclude unwanted domains
						const isExcluded = excludedDomains.some(
							(domain) => hostname.includes(domain)
						);

						if (isExcluded) {
							console.log(
								`   ⚠️ Filtered out excluded domain: ${url.substring(
									0,
									60
								)}...`
							);
							return false;
						}

						return true;
					} catch {
						return false;
					}
				})
				.slice(0, 5);

			console.log(
				`   ✅ Found ${validUrls.length} URLs from Perplexity`
			);
			return validUrls;
		} catch (error: any) {
			console.error(
				`   ❌ Perplexity API error: ${error?.message || error}`
			);
			console.warn(
				`   ⚠️ Perplexity search failed. Please ensure PERPLEXITY_API_KEY is set in .env`
			);
			return [];
		}
	}

	// If PERPLEXITY_API_KEY is not set, return empty
	console.warn(
		'   ⚠️ PERPLEXITY_API_KEY not configured. Please set it in .env file'
	);
	return [];
	*/

	// NEW: Use OpenAI with Google Custom Search
	const openaiApiKey = process.env.OPENAI_API_KEY;

	if (!openaiApiKey) {
		console.warn(
			'   ⚠️ OPENAI_API_KEY not configured. Please set it in .env file'
		);
		return [];
	}

	console.log('   🔍 Using OpenAI with Google Custom Search...');

	try {
		// Step 1: Get search results from Google Custom Search
		let searchResults: string[] = [];
		try {
			searchResults = await searchGoogleForUrls(userQuery);
			if (searchResults.length === 0) {
				console.warn(
					'   ⚠️ No results from Google Custom Search'
				);
				return [];
			}
		} catch (error: any) {
			// If Google Search is not configured, try to use OpenAI directly
			if (error.message?.includes('not configured')) {
				console.warn(
					'   ⚠️ Google Custom Search not configured. Using OpenAI only...'
				);
			} else {
				throw error;
			}
		}

		// Step 2: Use OpenAI to process, rank, and extract top 5 URLs with citations
		const openai = new OpenAI({ apiKey: openaiApiKey });

		const prompt = `You are a web research assistant. Analyze the following search results and extract the top 5 most relevant and authoritative URLs for the query: "${userQuery}"

Search Results:
${
	searchResults.length > 0
		? searchResults.map((url, idx) => `${idx + 1}. ${url}`).join('\n')
		: 'No search results provided'
}

Instructions:
1. Select the top 5 most relevant URLs that best match the query
2. Prioritize authoritative sources (reputable blogs, websites, documentation)
3. Ensure URLs are diverse and cover different aspects of the topic
4. Exclude the following domains:
   - cloud.google.com
   - ai.google.dev
   - console.cloud.google.com
   - developers.google.com
   - youtube.com
   - youtu.be
   - wikipedia.org
   - quora.com
5. Return a JSON object with a "urls" key containing an array of exactly 5 URL strings
6. Each URL must be a valid, complete URL starting with http:// or https://
7. If fewer than 5 valid URLs are available, return only the valid ones

Output format (JSON object only, no other text):
{"urls": ["https://example.com/article1", "https://example.com/article2", ...]}`;

		const completion = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [
				{
					role: 'system',
					content: 'You are a web research assistant. Return only valid JSON objects with a "urls" key containing an array of URLs.',
				},
				{
					role: 'user',
					content: prompt,
				},
			],
			temperature: 0.3,
			response_format: { type: 'json_object' },
		});

		const responseText =
			completion.choices[0]?.message?.content || '{}';
		let parsedResponse: any;

		try {
			// Try to parse as JSON object first
			parsedResponse = JSON.parse(responseText);
			// If it's an object, look for a 'urls' key or extract array values
			if (
				parsedResponse.urls &&
				Array.isArray(parsedResponse.urls)
			) {
				parsedResponse = parsedResponse.urls;
			} else if (Array.isArray(parsedResponse)) {
				// Already an array
			} else {
				// Try to find array in the response
				const arrayMatch = responseText.match(/\[.*\]/s);
				if (arrayMatch) {
					parsedResponse = JSON.parse(arrayMatch[0]);
				} else {
					throw new Error('No array found in response');
				}
			}
		} catch (parseError) {
			// Fallback: try to extract JSON array from text
			const arrayMatch = responseText.match(/\[.*\]/s);
			if (arrayMatch) {
				parsedResponse = JSON.parse(arrayMatch[0]);
			} else {
				console.error(
					'   ❌ Failed to parse OpenAI response:',
					responseText
				);
				// Fallback to using search results directly
				parsedResponse = searchResults.slice(0, 5);
			}
		}

		// Ensure we have an array
		if (!Array.isArray(parsedResponse)) {
			console.warn(
				'   ⚠️ OpenAI did not return an array, using search results directly'
			);
			parsedResponse = searchResults.slice(0, 5);
		}

		// Domains to exclude
		const excludedDomains = [
			'cloud.google.com',
			'ai.google.dev',
			'console.cloud.google.com',
			'developers.google.com',
			'youtube.com',
			'youtu.be',
			'wikipedia.org',
			'quora.com',
		];

		// Filter and validate URLs
		const seenUrls = new Set<string>();
		const validUrls = parsedResponse
			.filter((url: any) => {
				if (!url || typeof url !== 'string') return false;

				// Deduplicate
				const normalizedUrl = url.trim().toLowerCase();
				if (seenUrls.has(normalizedUrl)) return false;
				seenUrls.add(normalizedUrl);

				try {
					const urlObj = new URL(url);
					const hostname = urlObj.hostname.toLowerCase();

					// Exclude unwanted domains
					const isExcluded = excludedDomains.some(
						(domain) => hostname.includes(domain)
					);

					if (isExcluded) {
						console.log(
							`   ⚠️ Filtered out excluded domain: ${url.substring(
								0,
								60
							)}...`
						);
						return false;
					}

					return true;
				} catch {
					return false;
				}
			})
			.slice(0, 5);

		console.log(
			`   ✅ Found ${validUrls.length} URLs using OpenAI with web search`
		);
		return validUrls;
	} catch (error: any) {
		console.error(
			`   ❌ OpenAI web search error: ${error?.message || error}`
		);
		// Fallback: try to use Google Search results directly if available
		try {
			const fallbackResults = await searchGoogleForUrls(userQuery);
			if (fallbackResults.length > 0) {
				console.log(
					`   ⚠️ Using fallback: ${fallbackResults.length} URLs from Google Search`
				);
				return fallbackResults.slice(0, 5);
			}
		} catch (fallbackError) {
			// Ignore fallback errors
		}
		return [];
	}

	// FALLBACK: Original Gemini implementation (commented but kept for reference)
	/*
	console.log('   🔍 Using Gemini web search...');
	const ai = new GoogleGenAI({ apiKey });

	const prompt = `
	ROLE: You are a web research assistant specializing in finding relevant URLs and links.
	TASK: Search the web for the top 5 most relevant and authoritative URLs/articles related to the user's query.
	INSTRUCTIONS:
	1. Use the Google Search tool to find real, existing URLs/articles about the topic.
	2. Focus on URLs from authoritative sources (reputable blogs, websites, documentation).
	3. Return exactly 5 URLs that are most relevant to the user's query.
	4. The URLs should be diverse and cover different aspects of the topic.
	5. Output ONLY a clean JSON array of strings (URLs). Do not add any other text, pre-amble, or comments.
	6. Each URL must be a valid, complete URL starting with http:// or https://
	7. EXCLUDE the following types of URLs:
	   - Vertex AI documentation (cloud.google.com/vertex-ai)
	   - Google Cloud Platform documentation (cloud.google.com)
	   - Google AI documentation (ai.google.dev)
	   - Any internal Google documentation or API reference pages
	   - Focus on third-party blogs, articles, and independent sources

	USER QUERY: "${userQuery}"

	EXAMPLE OUTPUT:
	["https://example.com/article1", "https://example.com/article2", "https://example.com/article3"]
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
				console.log(
					`   ⏳ Rate limit hit. Retrying in ${Math.ceil(
						delay / 1000
					)}s (attempt ${attempt}/3)...`
				);
			},
		}
	);

	const extractedText = extractTextFromResponse(response);
	const urls = cleanAndParseJson(extractedText);

	// Domains to exclude (Vertex AI, Google Cloud, Google AI documentation)
	const excludedDomains = [
		'cloud.google.com',
		'ai.google.dev',
		'console.cloud.google.com',
		'developers.google.com',
	];

	// Validate URLs, filter out excluded domains, and return top 5
	const validUrls = Array.isArray(urls)
		? urls
				.filter((url: any) => {
					if (typeof url !== 'string') return false;
					try {
						const urlObj = new URL(url);
						const hostname =
							urlObj.hostname.toLowerCase();

						// Exclude Google Cloud, Vertex AI, and Google AI documentation
						const isExcluded = excludedDomains.some(
							(domain) => hostname.includes(domain)
						);

						if (isExcluded) {
							console.log(
								`   ⚠️ Filtered out excluded domain: ${url}`
							);
							return false;
						}

						return true;
					} catch {
						return false;
					}
				})
				.slice(0, 5)
		: [];

	return validUrls;
	*/

	// If OpenAI fails and no fallback, return empty
	console.error('   ❌ OpenAI web search failed');
	return [];
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
					console.log(
						`   ⏳ Retrying keyword filter in ${Math.ceil(
							delay / 1000
						)}s (attempt ${attempt}/2)...`
					);
				},
			}
		);

		const extractedText = extractTextFromResponse(response);
		const filteredKeywords = cleanAndParseJson(extractedText);

		return Array.isArray(filteredKeywords) ? filteredKeywords : [];
	} catch (err) {
		console.error(
			'❌ Failed to filter keywords with LLM, using fallback filter:',
			err
		);
		// Fallback: simple heuristic filter
		return keywords.filter((kw) => {
			const words = kw.toLowerCase().split(/\s+/);
			// Filter out single generic words
			if (words.length === 1) {
				const genericWords = new Set([
					'right',
					'using',
					'guide',
					'best',
					'about',
					'use',
					'choosing',
					'service',
				]);
				return !genericWords.has(words[0]);
			}
			// Filter out incomplete phrases
			const incompletePatterns = [
				'about use',
				'choosing right',
				'right database',
			];
			return !incompletePatterns.some((pattern) =>
				kw.toLowerCase().includes(pattern)
			);
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

	const outlineWebQuery = [data.title, data.topic, data.primaryKeyword]
		.map((s) => String(s || '').trim())
		.filter(Boolean)
		.join(' - ')
		.trim();
	let webReferenceTitles: string[] = [];
	let webReferenceUrls: string[] = [];
	let webReferenceKeywords: string[] = [];
	if (outlineWebQuery) {
		try {
			webReferenceTitles = await searchWebForTitles(outlineWebQuery, apiKey);
		} catch {
			webReferenceTitles = [];
		}
		try {
			webReferenceUrls = await searchWebForUrls(outlineWebQuery, apiKey);
		} catch {
			webReferenceUrls = [];
		}
		if (webReferenceUrls.length > 0) {
			try {
				const extracted = await extractKeywordsFromUrls(
					webReferenceUrls,
					(data.topic || data.title || outlineWebQuery).trim(),
					apiKey
				);
				webReferenceKeywords = Array.isArray(extracted)
					? extracted
							.map((k) => (k && typeof k.text === 'string' ? k.text : ''))
							.filter(Boolean)
					: [];
			} catch {
				webReferenceKeywords = [];
			}
		}
	}

	const hasUserReferences =
		(!!data.referenceUrls && data.referenceUrls.length > 0) ||
		(!!data.referenceFiles && data.referenceFiles.length > 0);
	const webContextSection = `

WEB RESEARCH CONTEXT (use this to inform the outline structure and ensure topical coverage):
- If the user provided reference URLs/files, treat them as the PRIMARY source of truth and only use web research to fill gaps or validate common subtopics.
- If the user did NOT provide references, rely on this web research heavily to propose the most relevant and up-to-date outline.

USER REFERENCES PRESENT: ${hasUserReferences ? 'YES' : 'NO'}

WEB REFERENCE TITLES (real titles found on the web):
${(webReferenceTitles || []).slice(0, 20).map((t, i) => `${i + 1}. ${t}`).join('\n') || '(none)'}

WEB REFERENCE URLS:
${(webReferenceUrls || []).slice(0, 10).map((u, i) => `${i + 1}. ${u}`).join('\n') || '(none)'}

WEB-EXTRACTED KEYWORDS (from URLs/titles):
${(webReferenceKeywords || []).slice(0, 30).join(', ') || '(none)'}
`;

	if (feedback && data.outline.length > 0) {
		// Regeneration flow
		const prompt = `${REGENERATION_PROMPT(data, feedback)}${webContextSection}`;
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
	const plannerPrompt = `${PLANNING_PROMPT(data)}${webContextSection}`;
	const plannerContentParts = await buildContentParts(plannerPrompt, data);
	const plannerResponse: GenerateContentResponse = await retryWithBackoff(
		async () => {
			return await ai.models.generateContent({
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
				console.log(
					`   ⏳ Rate limit hit. Retrying in ${Math.ceil(
						delay / 1000
					)}s (attempt ${attempt}/3)...`
				);
			},
		}
	);
	const h2Plan: string[] = cleanAndParseJson(plannerResponse.text);

	if (!h2Plan || h2Plan.length === 0) {
		throw new Error(
			'Could not generate H2 headings based on the provided context.'
		);
	}

	// 2. Executor Agent: Generate H3s for each H2 in parallel (with context for continuity)
	// Process in parallel for speed - each section knows its position and can reference neighbors
	console.log(
		`   🚀 Generating H3 subheadings for ${h2Plan.length} sections in parallel...`
	);

	const outlinePromises = h2Plan.map(async (h2Name, i) => {
		const h2Id = (i + 1).toString();
		const previousH2 = i > 0 ? h2Plan[i - 1] : undefined;
		const nextH2 = i < h2Plan.length - 1 ? h2Plan[i + 1] : undefined;

		const executorPrompt = `${EXECUTION_PROMPT(
			data,
			h2Name,
			h2Id,
			previousH2,
			nextH2
		)}${webContextSection}`;
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
						console.log(
							`   ⏳ Rate limit hit. Retrying in ${Math.ceil(
								delay / 1000
							)}s (attempt ${attempt}/3)...`
						);
					},
				}
			);

		const section = cleanAndParseJson(
			executorResponse.text
		) as OutlineSection;

		// Normalize items: ensure all items are objects with id and name
		if (section.items && Array.isArray(section.items)) {
			section.items = section.items.map((item, idx) => {
				// If item is a string, convert it to an object
				if (typeof item === 'string') {
					return {
						id: `${section.id || i + 1}${idx + 1}`,
						name: item,
					};
				}
				// If item is an object but missing id or name, fix it
				if (typeof item === 'object' && item !== null) {
					return {
						id:
							item.id ||
							`${section.id || i + 1}${idx + 1}`,
						name: item.name || String(item),
					};
				}
				// Fallback for any other type
				return {
					id: `${section.id || i + 1}${idx + 1}`,
					name: String(item),
				};
			});
		}

		console.log(
			`   ✅ Generated H3s for section ${i + 1}/${
				h2Plan.length
			}: "${h2Name}" (${section.items?.length || 0} H3 subheadings)`
		);

		return section;
	});

	// Wait for all sections to complete in parallel
	const fullOutline = await Promise.all(outlinePromises);

	// Sort by ID to ensure correct order (in case promises resolve out of order)
	fullOutline.sort((a, b) => {
		const aId = parseInt(a.id || '0');
		const bId = parseInt(b.id || '0');
		return aId - bId;
	});

	// ✨ ENFORCE: Ensure Conclusion and FAQs sections are always present at the end
	const conclusionKeywords = [
		'conclusion',
		'summary',
		'wrap up',
		'final thoughts',
		'key takeaways',
	];
	const faqKeywords = [
		'faq',
		'frequently asked',
		'common questions',
		'questions',
		'faqs',
	];

	// Separate main sections from conclusion/FAQ sections
	const mainSections: OutlineSection[] = [];
	let conclusionSection: OutlineSection | null = null;
	let faqSection: OutlineSection | null = null;

	fullOutline.forEach((section) => {
		const nameLower = section.name?.toLowerCase() || '';
		const isConclusion = conclusionKeywords.some((kw) =>
			nameLower.includes(kw)
		);
		const isFAQ = faqKeywords.some((kw) => nameLower.includes(kw));

		if (isConclusion) {
			conclusionSection = section;
		} else if (isFAQ) {
			faqSection = section;
		} else {
			mainSections.push(section);
		}
	});

	// Build final outline: main sections, then conclusion, then FAQs
	const finalOutline: OutlineSection[] = [...mainSections];

	// Add conclusion second-to-last (create if missing)
	if (conclusionSection) {
		finalOutline.push(conclusionSection);
	} else {
		const conclusionId = (finalOutline.length + 1).toString();
		finalOutline.push({
			id: conclusionId,
			name: 'Conclusion',
			items: [
				{ id: `${conclusionId}1`, name: 'Key Takeaways' },
				{ id: `${conclusionId}2`, name: 'Final Thoughts' },
			],
		});
		console.log('   ✅ Added missing Conclusion section');
	}

	// Add FAQs last (create if missing)
	if (faqSection) {
		finalOutline.push(faqSection);
	} else {
		const faqId = (finalOutline.length + 1).toString();
		finalOutline.push({
			id: faqId,
			name: 'Frequently Asked Questions (FAQs)',
			items: [
				{ id: `${faqId}1`, name: 'Question 1' },
				{ id: `${faqId}2`, name: 'Question 2' },
				{ id: `${faqId}3`, name: 'Question 3' },
				{ id: `${faqId}4`, name: 'Question 4' },
				{ id: `${faqId}5`, name: 'Question 5' },
			],
		});
		console.log('   ✅ Added missing FAQs section');
	}

	// Re-number IDs to ensure sequential order
	finalOutline.forEach((section, index) => {
		section.id = (index + 1).toString();
		if (section.items && Array.isArray(section.items)) {
			section.items = section.items.map((item, itemIndex) => {
				// Ensure item is an object, not a string
				if (typeof item === 'string') {
					return {
						id: `${section.id}${itemIndex + 1}`,
						name: item,
					};
				}
				// If item is an object, update its id
				if (typeof item === 'object' && item !== null) {
					return {
						...item,
						id: `${section.id}${itemIndex + 1}`,
						name: item.name || String(item),
					};
				}
				// Fallback
				return {
					id: `${section.id}${itemIndex + 1}`,
					name: String(item),
				};
			});
		}
	});

	console.log(
		`   ✅ [OUTLINE GENERATION] Complete! Generated ${
			finalOutline.length
		} H2 sections with ${finalOutline.reduce(
			(sum, s) => sum + (s.items?.length || 0),
			0
		)} total H3 subheadings`
	);
	console.log(
		`   ✅ Verified: Conclusion and FAQs sections are present at the end`
	);

	return finalOutline;
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
