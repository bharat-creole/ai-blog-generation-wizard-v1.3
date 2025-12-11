import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import { BlogData, Interlink, OutlineSection } from '../types';

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
	}
): Promise<string> => {
	if (!apiKey) throw new Error('API Key is required.');
	const ai = new GoogleGenAI({ apiKey });

	const prompt = `ROLE: You are an expert SEO Content Writer specializing in original, valuable, and SEO-friendly content.
TASK: Write the content for one H2 section of a blog, including its H3 items if any.

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
   - Include secondary keywords where relevant: ${data.secondaryKeywords?.join(', ') || 'N/A'}

6. **E-E-A-T (Experience, Expertise, Authoritativeness, Trust):**
   - Write with authority and expertise
   - Use phrasing like "In practice...", "A common challenge is...", "Research shows..."
   - Ensure all information is accurate and trustworthy

7. **Internal Links:**
   - Integrate INTERNAL LINKS inline when relevant using Markdown [text](url)
   - Do not just list them - make them contextual
   ${opts.interlinks.length > 0
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
- Start with the H2 heading: ## ${section.name}
- Then write content for each H3 subheading in order
- Ensure smooth transitions between H3 subheadings
- Make the content flow logically and maintain reader engagement
`;

	const response = await ai.models.generateContent({
		model: 'gemini-2.5-flash',
		contents: { parts: [{ text: prompt }] },
		config: {
			tools: [{ googleSearch: {} }], // Removed urlContext since we're not using references
		},
	});

	return extractTextFromResponse(response);
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
