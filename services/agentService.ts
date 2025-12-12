import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import OpenAI from 'openai';
import { BlogData, Interlink, OutlineSection } from '../types';
import { detectModelType, getApiModelName } from '../server/db/userService';

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

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
	const cleanedText = text
		.replace(/^```json\s*/, '')
		.replace(/```\s*$/, '')
		.trim();
	return JSON.parse(cleanedText);
};

// Generate content for a single outline section (H2 and its H3s)
export const generateSectionContent = async (
	data: BlogData,
	section: OutlineSection,
	apiKey: string,
	opts: {
		targetKeyword: string;
		interlinks: Interlink[];
		referenceUrls: string[];
		language?: string; // Language code (e.g., 'en', 'es', 'zh', 'de')
		model?: string; // Model code from database (e.g., 'gpt_4o', 'gemini_2_5_flash')
	}
): Promise<string> => {
	// ✨ Detect model type and get appropriate API key
	const modelCode = opts.model || 'gemini_2_5_flash'; // Default to Gemini
	const modelType = detectModelType(modelCode);
	const apiModelName = getApiModelName(modelCode, modelType);

	// Get appropriate API key based on model type
	let apiKeyToUse = apiKey;
	if (modelType === 'gpt') {
		// For GPT models, use OpenAI API key from environment or provided key
		apiKeyToUse = process.env.OPENAI_API_KEY || apiKey;
		if (!apiKeyToUse) {
			console.warn(
				'⚠️ [MODEL] OpenAI API key not found, falling back to Gemini'
			);
			// Fallback to Gemini
			const geminiKey = process.env.GEMINI_API_KEY || apiKey;
			if (!geminiKey) {
				throw new Error(
					'API Key is required. Please set OPENAI_API_KEY or GEMINI_API_KEY in your .env file or provide apiKey.'
				);
			}
			return generateSectionContentWithGemini(
				data,
				section,
				geminiKey,
				opts
			);
		}
	} else {
		// For Gemini models, use Gemini API key
		apiKeyToUse = process.env.GEMINI_API_KEY || apiKey;
		if (!apiKeyToUse) {
			throw new Error(
				'API Key is required. Please set GEMINI_API_KEY in your .env file or provide apiKey.'
			);
		}
	}

	// Route to appropriate generator based on model type
	if (modelType === 'gpt') {
		return generateSectionContentWithGPT(
			data,
			section,
			apiKeyToUse,
			opts,
			apiModelName
		);
	} else {
		return generateSectionContentWithGemini(
			data,
			section,
			apiKeyToUse,
			opts,
			apiModelName
		);
	}
};

// Helper function for Gemini generation
const generateSectionContentWithGemini = async (
	data: BlogData,
	section: OutlineSection,
	apiKey: string,
	opts: {
		targetKeyword: string;
		interlinks: Interlink[];
		referenceUrls: string[];
		language?: string;
	},
	modelName: string = 'gemini-2.5-flash'
): Promise<string> => {
	const ai = new GoogleGenAI({ apiKey });

	// Map language codes to human-readable names
	const languageMap: Record<string, string> = {
		en: 'English',
		es: 'Spanish',
		zh: 'Chinese (Simplified)',
		'zh-HK': 'Chinese (Traditional - Hong Kong)',
		zh_HK: 'Chinese (Traditional - Hong Kong)',
		de: 'German',
	};

	// Default to English if language not provided or invalid
	const languageCode = opts.language || 'en';
	const languageName = languageMap[languageCode] || 'English';

	const prompt = `ROLE: You are an expert SEO Content Writer specializing in original, valuable, and SEO-friendly content.
TASK: Write the content for one H2 section of a blog, including its H3 items if any.

LANGUAGE REQUIREMENT (CRITICAL):
- Write ALL content in ${languageName} (${languageCode})
- This includes headings, paragraphs, lists, and all text
- Ensure proper grammar, spelling, and natural phrasing in ${languageName}
- Maintain cultural appropriateness for ${languageName} readers

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
   - Provide in-depth, comprehensive information for this section
   - Do not write superficial content
   - Include real examples, research-backed insights, case studies, or statistics wherever relevant

4. **Rich Formatting:**
   - Use Markdown tables for comparisons or data
   - Use bullet points and numbered lists wherever appropriate
   - Use bold/italic for emphasis when needed
   - Maintain consistent formatting and flow

5. **SEO Optimization:**
   - Integrate the primary keyword naturally: "${opts.targetKeyword}"
   - Keywords should feel natural, not forced
   - Include secondary keywords where relevant: ${
		data.secondaryKeywords?.join(', ') || 'N/A'
   }

6. **E-E-A-T (Experience, Expertise, Authoritativeness, Trust):**
   - Write with authority and expertise
   - Use phrasing like "In practice...", "A common challenge is...", "Research shows..."
   - Ensure all information is accurate and trustworthy

7. **Internal Links:**
   - Integrate INTERNAL LINKS inline when relevant using Markdown [text](url)
   - Do not just list them - make them contextual
   ${
		opts.interlinks.length > 0
			? `Available internal links:\n${opts.interlinks
					.map((l) => `- ${l.keyword}: ${l.url}`)
					.join('\n')}`
			: '(No internal links provided)'
   }

SECTION DETAILS:
- Blog Title: ${data.title}
- Blog Topic: ${data.topic || 'N/A'}
- Section (H2): ${section.name}
- Subheadings (H3):\n${
		section.items?.map((i) => `  - ${i.name}`).join('\n') || '  (none)'
	}

OUTPUT:
- Output Markdown for ONLY this section
- Write ALL content in ${languageName} (${languageCode})
- Start with the H2 heading: ## ${section.name}
- Then write content for each H3 subheading in order
- Ensure smooth transitions between H3 subheadings
- Make the content flow logically and maintain reader engagement
`;

	const response = await ai.models.generateContent({
		model: modelName,
		contents: { parts: [{ text: prompt }] },
		config: {
			tools: [{ googleSearch: {} }], // Removed urlContext since we're not using references
		},
	});

	return extractTextFromResponse(response);
};

// Helper function for GPT generation
const generateSectionContentWithGPT = async (
	data: BlogData,
	section: OutlineSection,
	apiKey: string,
	opts: {
		targetKeyword: string;
		interlinks: Interlink[];
		referenceUrls: string[];
		language?: string;
	},
	modelName: string = 'gpt-4o'
): Promise<string> => {
	const openai = new OpenAI({ apiKey });

	// Map language codes to human-readable names
	const languageMap: Record<string, string> = {
		en: 'English',
		es: 'Spanish',
		zh: 'Chinese (Simplified)',
		'zh-HK': 'Chinese (Traditional - Hong Kong)',
		zh_HK: 'Chinese (Traditional - Hong Kong)',
		de: 'German',
	};

	// Default to English if language not provided or invalid
	const languageCode = opts.language || 'en';
	const languageName = languageMap[languageCode] || 'English';

	const prompt = `ROLE: You are an expert SEO Content Writer specializing in original, valuable, and SEO-friendly content.
TASK: Write the content for one H2 section of a blog, including its H3 items if any.

LANGUAGE REQUIREMENT (CRITICAL):
- Write ALL content in ${languageName} (${languageCode})
- This includes headings, paragraphs, lists, and all text
- Ensure proper grammar, spelling, and natural phrasing in ${languageName}
- Maintain cultural appropriateness for ${languageName} readers

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
   - Provide in-depth, comprehensive information for this section
   - Do not write superficial content
   - Include real examples, research-backed insights, case studies, or statistics wherever relevant

4. **Rich Formatting:**
   - Use Markdown tables for comparisons or data
   - Use bullet points and numbered lists wherever appropriate
   - Use bold/italic for emphasis when needed
   - Maintain consistent formatting and flow

5. **SEO Optimization:**
   - Integrate the primary keyword naturally: "${opts.targetKeyword}"
   - Keywords should feel natural, not forced
   - Include secondary keywords where relevant: ${
		data.secondaryKeywords?.join(', ') || 'N/A'
   }

6. **E-E-A-T (Experience, Expertise, Authoritativeness, Trust):**
   - Write with authority and expertise
   - Use phrasing like "In practice...", "A common challenge is...", "Research shows..."
   - Ensure all information is accurate and trustworthy

7. **Internal Links:**
   - Integrate INTERNAL LINKS inline when relevant using Markdown [text](url)
   - Do not just list them - make them contextual
   ${
		opts.interlinks.length > 0
			? `Available internal links:\n${opts.interlinks
					.map((l) => `- ${l.keyword}: ${l.url}`)
					.join('\n')}`
			: '(No internal links provided)'
   }

SECTION DETAILS:
- Blog Title: ${data.title}
- Blog Topic: ${data.topic || 'N/A'}
- Section (H2): ${section.name}
- Subheadings (H3):\n${
		section.items?.map((i) => `  - ${i.name}`).join('\n') || '  (none)'
	}

OUTPUT:
- Output Markdown for ONLY this section
- Write ALL content in ${languageName} (${languageCode})
- Start with the H2 heading: ## ${section.name}
- Then write content for each H3 subheading in order
- Ensure smooth transitions between H3 subheadings
- Make the content flow logically and maintain reader engagement
`;

	try {
		const completion = await openai.chat.completions.create({
			model: modelName,
			messages: [
				{
					role: 'system',
					content: 'You are an expert SEO Content Writer. Generate high-quality, original blog content in the specified language.',
				},
				{
					role: 'user',
					content: prompt,
				},
			],
			temperature: 0.7,
			max_tokens: 4000,
		});

		const content = completion.choices[0]?.message?.content;
		if (!content) {
			throw new Error('GPT model did not return content');
		}

		return content;
	} catch (error: any) {
		console.error('❌ [GPT] Error generating content:', error);
		// Fallback to Gemini if GPT fails
		console.warn('⚠️ [GPT] Falling back to Gemini model');
		const geminiKey = process.env.GEMINI_API_KEY || apiKey;
		if (!geminiKey) {
			throw new Error(
				'Failed to generate content with GPT and no Gemini fallback available'
			);
		}
		return generateSectionContentWithGemini(
			data,
			section,
			geminiKey,
			opts
		);
	}
};

export const chatAgentRespond = async (
	messages: ChatMessage[],
	currentDraft: string,
	targetKeyword: string,
	apiKey: string,
	interlinks: Interlink[] = [],
	referenceUrls: string[] = []
): Promise<{ assistantMessage: string; draftDelta: string }> => {
	if (!apiKey) throw new Error('API Key is required.');
	const ai = new GoogleGenAI({ apiKey });

	const conversation = messages
		.map((m) => `${m.role.toUpperCase()}: ${m.content}`)
		.join('\n\n');

	const prompt = `ROLE: You are an expert Blog Agent that collaborates via chat to plan and write a blog.
INSTRUCTIONS:
1. Read the conversation so far and the current Markdown draft.
2. If the user asks for changes or new sections, propose improvements clearly, then produce an updated passage to append.
3. Maintain a professional, educational tone. Integrate the target keyword naturally: "${targetKeyword}".
4. If you detect URLs in the conversation, integrate them as Markdown links inline where contextually relevant. If there are many, also add a short "Further Reading" section with bullet links at the end of the draft.
5. Keep responses concise. Use lists and short paragraphs. If producing content, write in Markdown.
6. OUTPUT ONLY a JSON object with exactly two string fields: assistantMessage and draftDelta. assistantMessage is your reply in chat; draftDelta is the content to append to the draft (may be empty string if no change to draft). Do not include any extra commentary or code fences.

CONVERSATION:
---
${conversation}
---

CURRENT DRAFT (Markdown):
---
${currentDraft}
---`;

	const interlinkBlock = interlinks.length
		? `\n\nINTERNAL LINKS TO INTEGRATE (use as contextual Markdown links):\n${interlinks
				.map((l) => `- ${l.keyword}: ${l.url}`)
				.join('\n')}`
		: '';

	const finalPrompt = prompt + interlinkBlock;

	const response = await ai.models.generateContent({
		model: 'gemini-2.5-flash',
		contents: { parts: [{ text: finalPrompt }] },
		config: {
			tools: [{ googleSearch: {} }], // Removed urlContext since we're not using references
		},
	});

	return cleanAndParseJson(extractTextFromResponse(response));
};
