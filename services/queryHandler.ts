import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import { AgentState } from './langgraph/agentGraph';

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

export interface QueryResponse {
	answer: string;
	actionRequired?:
		| 'run_keyword_research'
		| 'run_title_generation'
		| 'show_seo_score'
		| 'skip_step'
		| 'none';
	stateUpdates?: Partial<AgentState>;
}

export const handleQuery = async (
	query: string,
	state: AgentState,
	apiKey: string
): Promise<QueryResponse> => {
	if (!apiKey) throw new Error('API Key is required.');
	const ai = new GoogleGenAI({ apiKey });

	const prompt = `
You are a helpful assistant for a blog generation agent. Answer the user's question and suggest what action to take.

USER QUERY: "${query}"

CURRENT STATE:
- Topic: ${state.data.topic || 'not set'}
- Primary Keyword: ${state.data.primaryKeyword || 'not set'}
- Title: ${state.data.title || 'not set'}
- Has Outline: ${state.outline?.length > 0 ? 'yes' : 'no'}
- Current Step: ${state.halt?.reason || 'in progress'}

COMMON QUERIES:
- "Can you suggest keywords?" → Run keyword research and recommend best one
- "What title would you recommend?" → Generate titles and recommend top one
- "Should I add internal links?" → Provide guidance
- "How's my SEO?" → Show SEO score analysis
- "Skip this step" → Skip current optional step
- "What should I do next?" → Guide user on next action

INSTRUCTIONS:
1. Provide a helpful, conversational answer
2. Suggest specific action if needed
3. Keep responses concise (2-3 sentences max)

RESPONSE FORMAT: Plain text answer
`;

	const response = await ai.models.generateContent({
		model: 'gemini-2.5-flash',
		contents: { parts: [{ text: prompt }] },
	});

	const answer = extractTextFromResponse(response).trim();

	// Detect action based on query patterns
	let actionRequired: QueryResponse['actionRequired'] = 'none';

	const lowerQuery = query.toLowerCase();
	if (
		lowerQuery.includes('keyword') &&
		(lowerQuery.includes('suggest') ||
			lowerQuery.includes('recommend') ||
			lowerQuery.includes('best'))
	) {
		actionRequired = 'run_keyword_research';
	} else if (
		lowerQuery.includes('title') &&
		(lowerQuery.includes('suggest') ||
			lowerQuery.includes('recommend') ||
			lowerQuery.includes('what'))
	) {
		actionRequired = 'run_title_generation';
	} else if (
		lowerQuery.includes('seo') ||
		lowerQuery.includes('rank') ||
		lowerQuery.includes('score')
	) {
		actionRequired = 'show_seo_score';
	} else if (
		lowerQuery.includes('skip') ||
		lowerQuery.includes('pass') ||
		lowerQuery.includes('next')
	) {
		actionRequired = 'skip_step';
	}

	return {
		answer,
		actionRequired,
	};
};

export const generateRecommendation = async (
	type: 'keyword' | 'title' | 'tone',
	options: string[],
	context: string,
	apiKey: string
): Promise<{ recommendation: string; reason: string }> => {
	if (!apiKey) throw new Error('API Key is required.');
	const ai = new GoogleGenAI({ apiKey });

	const prompt = `
You are an SEO expert. Recommend the best option from the list.

TYPE: ${type}
CONTEXT: ${context}
OPTIONS:
${options.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}

INSTRUCTIONS:
Recommend the single best option and explain why in 1-2 sentences.

RESPONSE FORMAT:
Recommendation: [exact option text]
Reason: [brief explanation]
`;

	const response = await ai.models.generateContent({
		model: 'gemini-2.5-flash',
		contents: { parts: [{ text: prompt }] },
	});

	const text = extractTextFromResponse(response).trim();
	const lines = text.split('\n');
	const recommendation =
		lines
			.find((l) => l.startsWith('Recommendation:'))
			?.replace('Recommendation:', '')
			.trim() || options[0];
	const reason =
		lines
			.find((l) => l.startsWith('Reason:'))
			?.replace('Reason:', '')
			.trim() || 'Best option based on SEO analysis';

	return { recommendation, reason };
};
