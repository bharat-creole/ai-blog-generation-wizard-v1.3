/**
 * Backend Conversation Handler - Processes user messages and manages conversation state
 * This is the main orchestrator that determines intent and handles modifications
 */

import { AgentState } from './state';

export interface ConversationResponse {
	assistantMessage: string;
	assistantMessages?: string[]; // Optional array of separate messages for different steps
	stateUpdates: Partial<AgentState>;
	shouldRunAgent: boolean;
}

/**
 * Main entry point - processes user message and returns appropriate response
 */
export const processMessage = async (
	userMessage: string,
	currentState: AgentState,
	apiKey: string
): Promise<ConversationResponse> => {
	console.log(`   [CONVERSATION HANDLER] Starting processMessage for "${userMessage.substring(0, 30)}..."`);
	// Delegate full message processing to the centralized UserAgent
	// The UserAgent is the single source of truth for intent, validation,
	// state updates, and tool/stepper invocation. This keeps the flow
	// consistent with the 'single agent' architecture.
	console.log(`   [CONVERSATION HANDLER] Importing UserAgent...`);
	const { default: UserAgent } = await import('./userAgent');
	console.log(`   [CONVERSATION HANDLER] Initializing UserAgent...`);
	const agent = new UserAgent(apiKey);
	console.log(`   [CONVERSATION HANDLER] Calling agent.handleUserMessage...`);
	const resp = await agent.handleUserMessage(userMessage, currentState as AgentState);
	console.log(`   [CONVERSATION HANDLER] agent.handleUserMessage completed.`);

	return {
		assistantMessage: resp.assistantMessage || '',
		assistantMessages: undefined,
		stateUpdates: resp.stateUpdates || {},
		shouldRunAgent: !!resp.shouldRunStepper,
	};
};
