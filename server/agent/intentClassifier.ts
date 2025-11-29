import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';
import { AgentState } from './state';
import { BlogData } from '../../types';
import { retryWithBackoff } from '../../utils/retryWithBackoff';

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

export interface UserIntent {
	type:
	| 'full_automation'
	| 'partial_info'
	| 'query'
	| 'refinement'
	| 'manual_control'
	| 'approval'
	| 'skip_step'
	| 'greeting'
	| 'help_request'
	| 'off_topic';
	extractedData?: Partial<BlogData>;
	missingFields?: string[];
	autoFillRequested?: boolean;
	specificRequest?: string;
	controlPreferences?: {
		wantsToChooseKeywords?: boolean;
		wantsToChooseTitle?: boolean;
		skipOptionalSteps?: boolean;
	};
}

export const classifyIntent = async (
	userMessage: string,
	currentState: AgentState,
	apiKey: string
): Promise<UserIntent> => {
	if (!apiKey) throw new Error('API Key is required.');
	const ai = new GoogleGenAI({ apiKey });

	const prompt = `
You are an intent classifier for a blog generation agent. Analyze the user's message carefully and classify their intent.

USER MESSAGE: "${userMessage}"

CURRENT STATE:
- Has topic: ${!!currentState.data.topic}
- Has primary keyword: ${!!currentState.data.primaryKeyword}
- Has title: ${!!currentState.data.title}
- Has outline: ${currentState.outline?.length > 0}
- Current halt reason: ${currentState.halt?.reason || 'none'}

CRITICAL CLASSIFICATION RULES (PRIORITY ORDER - CHECK IN THIS ORDER):

1. **GREETINGS** (HIGHEST PRIORITY)
   - If user says ONLY: "hi", "hello", "hey", "good morning", "good evening", "howdy", or similar greetings
   - Even if they include "hi" with something else, prioritize greeting if it's the main intent
   - Example: "Hi" → type: "greeting"
   - Example: "Hello there" → type: "greeting"

2. **AUTOMATION REQUESTS** (SECOND HIGHEST PRIORITY)
   - If message contains automation phrases like: "generate blog by yourself", "handle it by yourself", "you handle it", "do it yourself", "handle it automatically", "you decide everything", "create blog yourself", "full auto", "automatic mode"
   - These phrases mean user wants FULL automation, NOT that they're providing a topic
   - Example: "generate blog by yourself" → type: "full_automation", autoFillRequested: true, extractedData.topic: null
   - Example: "handle it by yourself" → type: "full_automation", autoFillRequested: true
   - DO NOT extract "blog" or "it" as a topic when these phrases are used

3. **HELP REQUESTS**
   - "what can you do", "how can you help", "what are your capabilities"
   - type: "help_request"

4. **OFF-TOPIC QUESTIONS**
   - Weather, math, coding help, general knowledge NOT related to blog writing
   - type: "off_topic"

5. **QUERY ABOUT BLOG PROCESS**
   - Questions specifically about blog creation: "Can you suggest keywords?", "How's my SEO?"
   - type: "query"

6. **APPROVAL/CONFIRMATION**
   - "yes", "ok", "approve", "proceed", "looks good", "continue"
   - type: "approval"

7. **SKIP REQUEST**
   - "skip this", "skip step", "move on", "pass"
   - type: "skip_step"

8. **MANUAL CONTROL**
   - "I want to choose", "let me select", "I'll pick"
   - type: "manual_control"

9. **REFINEMENT**
   - User wants to modify existing content
   - type: "refinement"
   - **CRITICAL**: If user provides new values (e.g. "change topic to X", "use keywords Y"), EXTRACT them into extractedData!

10. **PARTIAL INFO** (LOWEST PRIORITY)
   - User provides actual blog data: topic, keywords, title, location
   - Example: "Write about cloud computing" → type: "partial_info", extractedData.topic: "cloud computing"
   - Example: "Topic: AWS" → type: "partial_info", extractedData.topic: "AWS"
   - ONLY use this if NO automation phrases are present

TOPIC EXTRACTION RULES:
- DO NOT extract "blog", "it", "yourself", "everything" as topics
- Only extract meaningful topics: "cloud computing", "AWS", "machine learning", etc.
- If message is ONLY automation phrases with no real topic, set extractedData.topic: null
- If user says "generate blog by yourself", the topic is NULL (they're requesting automation)
- If user says "write about AWS, you handle it", the topic is "AWS" AND autoFillRequested: true

CORRECTION PATTERN DETECTION (CRITICAL):
- Detect when user is correcting themselves: "as X actually", "I mean X", "correction: X", "actually X", "no, X"
- Extract ONLY the corrected value, NOT the entire phrase
- Examples:
  * "I was thinking about AI, as AI and ML actually" → extractedData.topic: "AI and ML" (corrected value)
  * "Topic is cloud, as AWS actually" → extractedData.topic: "AWS" (corrected value)
  * "I mean machine learning" → extractedData.topic: "machine learning" (corrected value)
  * "Actually, make it about Python" → extractedData.topic: "Python" (corrected value)
- If correction is ambiguous or unclear, set extractedData.topic: null and specificRequest: "clarification_needed"

CRITICAL: DO NOT EXTRACT BOTH TOPIC AND PRIMARY KEYWORD
- If user provides a topic (e.g., "I want to write about AI"), extract ONLY topic, NOT primaryKeyword
- Only extract primaryKeyword if user EXPLICITLY says "use keyword X" or "primary keyword: X"
- Example: "I was thinking about AI, as AI and ML" → extractedData.topic: "AI and ML", primaryKeyword: null
- Example: "Write about AI with primary keyword 'artificial intelligence'" → extractedData.topic: "AI", primaryKeyword: "artificial intelligence"

OUTPUT SCHEMA:
{
  "type": "greeting" | "help_request" | "off_topic" | "full_automation" | "partial_info" | "query" | "refinement" | "manual_control" | "approval" | "skip_step",
  "extractedData": {
    "topic": string | null,
    "primaryKeyword": string | null,
    "secondaryKeywords": string[] | null,
    "title": string | null,
    "targetLocation": string | null
  },
  "autoFillRequested": boolean,
  "specificRequest": string | null,
  "controlPreferences": {
    "wantsToChooseKeywords": boolean,
    "wantsToChooseTitle": boolean,
    "skipOptionalSteps": boolean
  }
}

EXAMPLES:
- "Hi" → type: "greeting", extractedData.topic: null
- "Hello" → type: "greeting", extractedData.topic: null
- "Good morning" → type: "greeting", extractedData.topic: null
- "What can you help me with?" → type: "help_request"
- "What's the weather today?" → type: "off_topic"
- "Generate blog by yourself" → type: "full_automation", autoFillRequested: true, extractedData.topic: null
- "Handle it yourself" → type: "full_automation", autoFillRequested: true, extractedData.topic: null
- "Do it yourself" → type: "full_automation", autoFillRequested: true, extractedData.topic: null
- "You handle it" → type: "full_automation", autoFillRequested: true, extractedData.topic: null
- "Generate blog automatically" → type: "full_automation", autoFillRequested: true, extractedData.topic: null
- "Write about cloud computing, you decide everything" → type: "full_automation", autoFillRequested: true, extractedData.topic: "cloud computing"
- "Topic: AWS" → type: "partial_info", extractedData.topic: "AWS"
- "Write a blog about machine learning" → type: "partial_info", extractedData.topic: "machine learning"
- "Can you suggest good keywords?" → type: "query", specificRequest: "keyword suggestions"
- "I want to pick my own title" → type: "manual_control", controlPreferences.wantsToChooseTitle: true
- "Skip the interlinking" → type: "skip_step"
- "Yes, proceed" → type: "approval"
`;

	const responseSchema = {
		type: Type.OBJECT,
		properties: {
			type: {
				type: Type.STRING,
				enum: [
					'greeting',
					'help_request',
					'off_topic',
					'full_automation',
					'partial_info',
					'query',
					'refinement',
					'manual_control',
					'approval',
					'skip_step',
				],
			},
			extractedData: {
				type: Type.OBJECT,
				properties: {
					topic: { type: Type.STRING, nullable: true },
					primaryKeyword: {
						type: Type.STRING,
						nullable: true,
					},
					secondaryKeywords: {
						type: Type.ARRAY,
						items: { type: Type.STRING },
						nullable: true,
					},
					title: { type: Type.STRING, nullable: true },
					targetLocation: {
						type: Type.STRING,
						nullable: true,
					},
				},
			},
			autoFillRequested: { type: Type.BOOLEAN },
			specificRequest: { type: Type.STRING, nullable: true },
			controlPreferences: {
				type: Type.OBJECT,
				properties: {
					wantsToChooseKeywords: { type: Type.BOOLEAN },
					wantsToChooseTitle: { type: Type.BOOLEAN },
					skipOptionalSteps: { type: Type.BOOLEAN },
				},
			},
		},
		required: ['type', 'autoFillRequested', 'controlPreferences'],
	};

	const response = await retryWithBackoff(
		async () => {
			return await ai.models.generateContent({
				model: 'gemini-flash-latest',
				contents: { parts: [{ text: prompt }] },
				config: {
					responseMimeType: 'application/json',
					responseSchema: responseSchema,
				},
			});
		},
		{
			maxRetries: 3,
			initialDelay: 1000,
			onRetry: (attempt, delay, error) => {
				console.log(`   ⏳ Rate limit hit. Retrying in ${Math.ceil(delay / 1000)}s (attempt ${attempt}/3)...`);
			},
		}
	);

	return cleanAndParseJson(extractTextFromResponse(response));
};
