import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import { BlogData } from '../../types';

/**
 * SecondaryAgent - Ephemeral Gemini agent for task-specific operations
 * 
 * This agent is designed to minimize token usage by only sending minimal context
 * to Gemini for specific tasks like intent classification and content generation.
 * 
 * Unlike the primary agent (LangGraph), this agent:
 * - Does NOT maintain conversation history
 * - Only receives task-specific context
 * - Is ephemeral (no state persistence)
 * - Optimized for cost efficiency
 */

// Helper to safely extract text from Gemini response
const extractTextFromResponse = (response: GenerateContentResponse): string => {
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

export class SecondaryAgent {
    private apiKey: string;
    private ai: GoogleGenAI;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
        this.ai = new GoogleGenAI({ apiKey });
    }

    /**
     * Generate blog titles based on keywords
     * Only sends minimal context - no full conversation history
     */
    async generateTitles(
        topic: string,
        primaryKeyword: string,
        secondaryKeywords: string[],
        targetLocation: string = 'United States'
    ): Promise<string[]> {
        const prompt = `Generate 5 SEO-optimized blog titles for:

Topic: ${topic}
Primary Keyword: ${primaryKeyword}
Secondary Keywords: ${secondaryKeywords.join(', ')}
Target Location: ${targetLocation}

Requirements:
- Include the primary keyword naturally
- Make titles engaging and click-worthy
- Optimize for SEO
- Target audience in ${targetLocation}

Return ONLY a JSON array of 5 title strings, nothing else.`;

        try {
            const response = await this.ai.models.generateContent({
                model: 'gemini-flash-latest',
                contents: { parts: [{ text: prompt }] },
                config: {
                    responseMimeType: 'application/json',
                },
            });

            const text = extractTextFromResponse(response);
            const titles = JSON.parse(text);

            console.log(`✅ [SECONDARY AGENT] Generated ${titles.length} titles (tokens saved: ~2000)`);
            return titles;
        } catch (error) {
            console.error('❌ [SECONDARY AGENT] Title generation failed:', error);
            return [];
        }
    }

    /**
     * Generate outline based on blog data
     * Only sends minimal context needed for outline generation
     */
    async generateOutline(blogData: BlogData): Promise<any[]> {
        const prompt = `Create a detailed blog outline for:

Title: ${blogData.title}
Topic: ${blogData.topic}
Primary Keyword: ${blogData.primaryKeyword}
Secondary Keywords: ${blogData.secondaryKeywords.join(', ')}

${blogData.referenceUrls && blogData.referenceUrls.length > 0 ? `
Reference URLs:
${blogData.referenceUrls.map((url, i) => `${i + 1}. ${url}`).join('\n')}
` : ''}

Requirements:
- Create 5-8 main sections (H2)
- Each section should have 2-4 subsections (H3)
- Ensure natural keyword integration
- Follow SEO best practices

Return ONLY a JSON array of sections with this structure:
[
  {
    "id": "section-1",
    "name": "Section Title",
    "items": [
      { "id": "item-1", "name": "Subsection Title" }
    ]
  }
]`;

        try {
            const response = await this.ai.models.generateContent({
                model: 'gemini-flash-latest',
                contents: { parts: [{ text: prompt }] },
                config: {
                    responseMimeType: 'application/json',
                },
            });

            const text = extractTextFromResponse(response);
            const outline = JSON.parse(text);

            console.log(`✅ [SECONDARY AGENT] Generated outline with ${outline.length} sections (tokens saved: ~1500)`);
            return outline;
        } catch (error) {
            console.error('❌ [SECONDARY AGENT] Outline generation failed:', error);
            return [];
        }
    }

    /**
     * Classify user intent with minimal context
     * Only sends current message and basic state info
     */
    async classifyIntent(
        userMessage: string,
        minimalState: {
            currentStep: string;
            hasTopic: boolean;
            hasPrimaryKeyword: boolean;
            hasTitle: boolean;
            hasOutline: boolean;
        }
    ): Promise<any> {
        const prompt = `Classify the user's intent:

User Message: "${userMessage}"

Current Context:
- Step: ${minimalState.currentStep}
- Has Topic: ${minimalState.hasTopic}
- Has Primary Keyword: ${minimalState.hasPrimaryKeyword}
- Has Title: ${minimalState.hasTitle}
- Has Outline: ${minimalState.hasOutline}

Classify as one of:
- greeting
- help_request
- off_topic
- full_automation
- partial_info
- refinement
- approval
- skip_step

Return JSON with:
{
  "type": "...",
  "extractedData": { "topic": "...", "primaryKeyword": "...", etc },
  "autoFillRequested": boolean
}`;

        try {
            const response = await this.ai.models.generateContent({
                model: 'gemini-flash-latest',
                contents: { parts: [{ text: prompt }] },
                config: {
                    responseMimeType: 'application/json',
                },
            });

            const text = extractTextFromResponse(response);
            const intent = JSON.parse(text);

            console.log(`✅ [SECONDARY AGENT] Classified intent: ${intent.type} (tokens saved: ~1800)`);
            return intent;
        } catch (error) {
            console.error('❌ [SECONDARY AGENT] Intent classification failed:', error);
            throw error;
        }
    }
}
