/**
 * Context Manager Agent
 *
 * - Has access to full AgentState (messages, topic, keywords, etc.).
 * - Handles questions ABOUT the conversation itself, like:
 *   - "What was my previous question?"
 *   - "What topic did I give earlier?"
 *   - "What did you suggest before?"
 *
 * It uses LLM but is grounded in the provided state.
 */

import { GoogleGenAI } from '@google/genai';
import { AgentState } from './state';

export interface ContextManagerResponse {
	assistantMessage: string;
}

export class ContextManagerAgent {
	private ai: GoogleGenAI;

	constructor(private apiKey: string) {
		this.ai = new GoogleGenAI({ apiKey });
	}

	/**
	 * Handle context-related user questions using state history.
	 */
	async handleContextQuery(
		userMessage: string,
		currentState: AgentState
	): Promise<ContextManagerResponse> {
		// We'll pass a small window of recent messages + key state fields
		const allMessages = currentState.messages || [];
		console.log(`📚 [CONTEXT MANAGER] Total messages in state: ${allMessages.length}`);
		
		// Get last 10 messages for better context
		const recentMessages = allMessages.slice(-10);
		
		// Better message extraction - handle different message formats
		const serializedMessages = recentMessages
			.map((m: any, idx: number) => {
				// Try different ways to get role
				let role = 'unknown';
				if (m.role) {
					role = m.role.toString();
				} else if (m._getType) {
					role = m._getType().toString();
				} else if (m.constructor?.name) {
					// LangChain message types: HumanMessage, AIMessage, SystemMessage
					role = m.constructor.name.replace('Message', '').toLowerCase();
					if (role === 'human') role = 'user';
				}
				
				// Try different ways to get content
				let content = '';
				if (typeof m.content === 'string') {
					content = m.content;
				} else if (m.content?.text) {
					content = m.content.text;
				} else if (Array.isArray(m.content)) {
					// Handle array of content parts
					content = m.content
						.map((part: any) => part.text || JSON.stringify(part))
						.join(' ');
				} else {
					content = JSON.stringify(m.content);
				}
				
				return `${idx + 1}. [${role}] ${content}`;
			})
			.join('\n');
		
		console.log(`📚 [CONTEXT MANAGER] Serialized ${recentMessages.length} messages`);
		console.log(`📚 [CONTEXT MANAGER] Messages preview: ${serializedMessages.substring(0, 200)}...`);

		const stateSnapshot = {
			topic: currentState.data?.topic,
			primaryKeyword: currentState.data?.primaryKeyword,
			secondaryKeywords: currentState.data?.secondaryKeywords,
			title: currentState.data?.title,
			currentStep: currentState.currentStep,
			haltReason: currentState.halt?.reason || null,
		};

		const prompt = `
You are a Context Manager for a blog generation assistant.

You are given:

1. Recent conversation messages (chronological, oldest to newest).

2. A snapshot of the current blog state (topic, keywords, title, current step, halt reason).

3. A user question that is about the conversation or state itself.

IMPORTANT: The current user question "${userMessage}" is NOT in the message history yet - it's the question they just asked.

Your job:

- Answer ONLY based on the provided history and state.

- Do NOT invent new topics or content.

- If the user asks "What was my previous question?", find the LAST USER message in the history (before the current question).

- Look for messages with role "user" or "human" - these are user messages.

- If you find user messages, identify the most recent one (the last one in the list).

- If no user messages exist in history, say: "I don't see any previous questions in our conversation history yet."

- If they ask "What topic did I give earlier?", check the state snapshot first, then look in messages.

- If they ask "What did you say before?", find the last assistant/AI message.

- Be specific and quote the actual message if you find it.

- If it's unclear, ask for clarification.

Return a short, clear answer in natural language. Do not return JSON.

RECENT MESSAGES (chronological order, oldest first):

${serializedMessages || '(no messages in history)'}

STATE SNAPSHOT:

${JSON.stringify(stateSnapshot, null, 2)}

CURRENT USER QUESTION (not in history above):

"${userMessage}"

Now answer the user's question based on the conversation history and state.
`;

		try {
			const response = await this.ai.models.generateContent({
				model: 'gemini-flash-latest',
				contents: { parts: [{ text: prompt }] },
			});

			const text = this.extractTextFromResponse(response);

			return {
				assistantMessage: text,
			};
		} catch (error) {
			console.error('❌ [CONTEXT MANAGER] Error:', error);
			return {
				assistantMessage:
					"I'm having trouble looking up the previous conversation right now. Could you repeat or restate what you need?",
			};
		}
	}

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

