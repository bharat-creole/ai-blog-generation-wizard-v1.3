import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';
import { AgentState } from './langgraph/agentGraph';
import { BlogData } from '../types';

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
		| 'skip_step';
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
You are an intent classifier for a blog generation agent. Analyze the user's message and classify their intent.

USER MESSAGE: "${userMessage}"

CURRENT STATE:
- Has topic: ${!!currentState.data.topic}
- Has primary keyword: ${!!currentState.data.primaryKeyword}
- Has title: ${!!currentState.data.title}
- Has outline: ${currentState.outline?.length > 0}
- Current halt reason: ${currentState.halt?.reason || 'none'}

INSTRUCTIONS:
1. Classify the intent type:
   - "full_automation": User wants agent to decide everything automatically
   - "partial_info": User provides some information (topic, keywords, title, etc.)
   - "query": User is asking a question
   - "refinement": User wants to modify/improve existing content
   - "manual_control": User explicitly wants to control specific steps
   - "approval": User is approving/confirming something
   - "skip_step": User wants to skip the current step

2. Extract any blog data mentioned (topic, keywords, title, location, etc.)

3. Detect automation preferences:
   - Does user want agent to auto-select options?
   - Does user want to choose themselves?
   - Does user want to skip optional steps?

4. Identify specific requests or questions

OUTPUT SCHEMA:
{
  "type": "full_automation" | "partial_info" | "query" | "refinement" | "manual_control" | "approval" | "skip_step",
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
- "Write a blog about cloud computing, you decide everything" → type: "full_automation", autoFillRequested: true
- "Topic: AWS, Keyword: database services" → type: "partial_info", extractedData filled
- "Can you suggest good keywords?" → type: "query", specificRequest: "keyword suggestions"
- "I want to pick my own title" → type: "manual_control", controlPreferences.wantsToChooseTitle: true
- "Skip the interlinking" → type: "skip_step"
- "Approve" or "Yes, proceed" → type: "approval"
`;

	const responseSchema = {
		type: Type.OBJECT,
		properties: {
			type: {
				type: Type.STRING,
				enum: [
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
					primaryKeyword: { type: Type.STRING, nullable: true },
					secondaryKeywords: {
						type: Type.ARRAY,
						items: { type: Type.STRING },
						nullable: true,
					},
					title: { type: Type.STRING, nullable: true },
					targetLocation: { type: Type.STRING, nullable: true },
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
		required: [
			'type',
			'autoFillRequested',
			'controlPreferences',
		],
	};

	const response = await ai.models.generateContent({
		model: 'gemini-flash-latest',
		contents: { parts: [{ text: prompt }] },
		config: {
			responseMimeType: 'application/json',
			responseSchema: responseSchema,
		},
	});

	return cleanAndParseJson(extractTextFromResponse(response));
};

