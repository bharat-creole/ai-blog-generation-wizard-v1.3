/**
 * Primary Agent - Router / Guardian
 *
 * Stateless.
 * Classifies the user message and decides:
 * - Is this a blog creation request?
 * - Is this a meta instruction (restart/reset)?
 * - Is this a context query (e.g., "what was my previous question?")
 * - Is this off-topic / abusive / small talk?
 *
 * It DOES NOT read history or manage memory.
 */

import { GoogleGenAI } from '@google/genai';
import { AgentState } from './state';

export type PrimaryMessageType =
	| 'blog_creation_request'
	| 'meta_instruction'
	| 'context_query'
	| 'general_question'
	| 'off_topic'
	| 'abusive_or_invalid'
	| 'irrelevant_small_talk';

export type PrimarySystemAction =
	| 'restart' // reset flow
	| 'abort' // do not go to intent classifier / graph
	| 'route_to_intent_classifier' // normal blog flow
	| 'route_to_context_manager'; // handle via Context Manager

export interface PrimaryAgentResponse {
	type: PrimaryMessageType;
	normalizedMessage: string;
	shouldProceed: boolean; // should we continue into blog/intent pipeline?
	systemAction: PrimarySystemAction;
	directResponse?: string; // used when aborting or answering directly
}

export class PrimaryAgent {
	private ai: GoogleGenAI;

	constructor(private apiKey: string) {
		this.ai = new GoogleGenAI({ apiKey });
	}

	/**
	 * Analyze user message and decide routing.
	 */
	async analyzeMessage(
		userMessage: string,
		currentState: AgentState
	): Promise<PrimaryAgentResponse> {
		const prompt = `
Act as a Primary Routing Agent for a blog generation system.

Your job:

1. Classify the user message into one of:

   - blog_creation_request

   - meta_instruction

   - context_query

   - general_question

   - off_topic

   - abusive_or_invalid

   - irrelevant_small_talk

2. Normalize the message:

   - Remove greetings and filler words.

   - Keep core intent and important context.

3. Decide systemAction:

   - "route_to_intent_classifier" → Normal blog flow (topic/keywords/title/etc.).

   - "route_to_context_manager"  → User is asking ABOUT previous conversation/context

       e.g., "what was my previous question?", "what did I say earlier?", "what topic did I give?"

   - "restart" → User wants to start over/reset (e.g., "start over", "reset flow")

   - "abort" → Off-topic, abusive, or general small talk not related to blog creation.

4. Set shouldProceed:

   - true  → We should continue into the blog/agent pipeline (intent classifier / context manager).

   - false → We should NOT continue; respond directly using "directResponse".

5. CRITICAL: If shouldProceed is false, you MUST provide a "directResponse" field with a helpful, friendly message.

USER MESSAGE:

"${userMessage}"

CURRENT STATE (for light context only, DO NOT act as memory):

- Has topic: ${!!currentState.data?.topic}

- Current step: ${currentState.currentStep || 'none'}

- Halted reason: ${currentState.halt?.reason || 'none'}

OUTPUT JSON FORMAT:

{

  "type": "blog_creation_request" | "meta_instruction" | "context_query" | "general_question" | "off_topic" | "abusive_or_invalid" | "irrelevant_small_talk",

  "normalizedMessage": "cleaned and normalized version of user message (if shouldProceed is true, this will be used for further processing)",

  "shouldProceed": true | false,

  "systemAction": "restart" | "abort" | "route_to_intent_classifier" | "route_to_context_manager",

  "directResponse": "REQUIRED if shouldProceed is false. Provide a helpful, friendly response to the user. Examples: For greetings: 'Hi! I'm here to help you create blog posts. What topic would you like to write about?' For off-topic: 'I'm focused on helping you create blog content. What topic would you like to write about?'"

}

EXAMPLES:

- "Hello" → { "type": "irrelevant_small_talk", "normalizedMessage": "hello", "shouldProceed": false, "systemAction": "abort", "directResponse": "Hi! I'm here to help you create blog posts. What topic would you like to write about?" }

- "What can you do?" → { "type": "general_question", "normalizedMessage": "what can you do", "shouldProceed": false, "systemAction": "abort", "directResponse": "I help you create SEO-optimized blog posts. Just tell me a topic and I'll guide you through keyword research, title generation, and content creation!" }
`;

		try {
			const response = await this.ai.models.generateContent({
				model: 'gemini-flash-latest',
				contents: { parts: [{ text: prompt }] },
				config: {
					responseMimeType: 'application/json',
				},
			});

			// Extract text from response
			const text = this.extractTextFromResponse(response);
			const result = JSON.parse(text) as PrimaryAgentResponse;

			// Validate and ensure required fields
			if (!result.normalizedMessage && result.shouldProceed) {
				result.normalizedMessage = userMessage; // Fallback to original if missing
			}

			console.log('🛡️ [PRIMARY AGENT]', {
				type: result.type,
				action: result.systemAction,
				normalized: result.normalizedMessage || '(empty)',
				shouldProceed: result.shouldProceed,
				hasDirectResponse: !!result.directResponse,
			});

			return result;
		} catch (error) {
			console.error('❌ [PRIMARY AGENT] Error:', error);
			// Fallback: treat as normal blog creation request
			return {
				type: 'blog_creation_request',
				normalizedMessage: userMessage,
				shouldProceed: true,
				systemAction: 'route_to_intent_classifier',
			};
		}
	}

	/**
	 * Helper to extract text from Gemini response
	 */
	private extractTextFromResponse(response: any): string {
		try {
			const parts = response?.candidates?.[0]?.content?.parts;
			if (parts && Array.isArray(parts)) {
				const text = parts
					.filter((p: any) => typeof p.text === 'string')
					.map((p: any) => p.text as string)
					.join('')
					.trim();
				if (text) return text;
			}
		} catch (e) {
			console.error('❌ Failed to extract text from response:', e);
		}

		throw new Error('Unable to extract text from Gemini response');
	}
}
