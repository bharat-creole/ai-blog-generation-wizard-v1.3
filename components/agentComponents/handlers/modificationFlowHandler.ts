import { ChatMessage, BlogData, AutomationLevel } from '../../../types';
import { AgentState } from '../../../../server/agent/state';
import * as conversationHandler from '../../../services/conversationHandler';
import { FlowContext } from '../types/agentTypes';
import {
	createModifiedAgentForRegeneration,
	updateAgentFromWorking,
	syncAgentStateToData,
	updateAllStateFromWorking,
	AgentStateSetters,
} from '../utils/agentStateUtils';
import { createAssistantMessage, createOutlineApprovalMessage } from '../utils/messageUtils';
import { runNext as lgRunNext } from '../../../services/langgraph/agentGraph';
import * as automationEngine from '../../../services/automationEngine';
import { getStepMessage } from '../utils/agentHelpers';

/**
 * Handles modification confirmation response from user (yes/no)
 * 
 * When user confirms modification, processes the pending modification request
 * and applies it to the agent state. When user declines, cancels modification mode.
 * 
 * @param input - User input (should be "yes" or "no")
 * @param agent - Current agent state
 * @param flowContext - Flow context state
 * @param apiKey - API key for agent operations
 * @param userMsg - User message object
 * @param setFlowContext - Function to update flow context
 * @param setMessages - Function to update messages
 * @param setAgent - Function to update agent state
 * @param setOutlineApproved - Function to update outline approval status
 * @param setOutline - Function to update outline
 * @param setDraft - Function to update draft content
 * @param setShowBlogContent - Function to show/hide blog content
 * @param setInput - Function to clear input
 * @param setIsThinking - Function to update thinking state
 * @param setError - Function to set error message
 * @param updateData - Function to update blog data
 * @param setUserTopic - Function to update user topic
 * @param setTargetLocation - Function to update target location
 * @param setIsStreaming - Function to update streaming state
 * @returns Promise<boolean> - True if handled, false otherwise
 */
export const handleModificationConfirmation = async (
	input: string,
	agent: AgentState,
	flowContext: FlowContext,
	apiKey: string,
	userMsg: ChatMessage,
	setFlowContext: React.Dispatch<React.SetStateAction<FlowContext>>,
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
	setAgent: React.Dispatch<React.SetStateAction<AgentState | null>>,
	setOutlineApproved: React.Dispatch<React.SetStateAction<boolean>>,
	setOutline: React.Dispatch<React.SetStateAction<any[]>>,
	setDraft: React.Dispatch<React.SetStateAction<string>>,
	setShowBlogContent: React.Dispatch<React.SetStateAction<boolean>>,
	setInput: React.Dispatch<React.SetStateAction<string>>,
	setIsThinking: React.Dispatch<React.SetStateAction<boolean>>,
	setError: React.Dispatch<React.SetStateAction<string | null>>,
	updateData: (data: Partial<BlogData>) => void,
	setUserTopic: React.Dispatch<React.SetStateAction<string>>,
	setTargetLocation: React.Dispatch<React.SetStateAction<string>>,
	setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>,
	sendUserMessage: (message: string, currentState: AgentState) => Promise<{ response: string; updatedState: AgentState; metadata?: Partial<ChatMessage> }>
): Promise<boolean> => {
	const confirmed = /^yes$/i.test(input.trim());

	if (confirmed) {
		const modificationRequest = flowContext.pendingModificationRequest;
		if (!modificationRequest) return false;

		const modifiedAgent = createModifiedAgentForRegeneration(agent);

		setAgent(modifiedAgent);
		setOutlineApproved(false);
		setOutline([]);
		setDraft('');
		setShowBlogContent(false);
		setInput('');
		setIsThinking(true);

		try {
			// ✨ Use backend API via sendUserMessage
			const result = await sendUserMessage(
				modificationRequest,
				modifiedAgent
			);

			const updatedAgent = result.updatedState;
			setAgent(updatedAgent);

			if (updatedAgent.data) {
				const updatedData = updatedAgent.data;
				updateData({ ...updatedData });

				if (updatedData.topic) setUserTopic(updatedData.topic);
				if (updatedData.targetLocation) {
					setTargetLocation(updatedData.targetLocation);
				}
			}

			setMessages((prev) => [
				...prev,
				userMsg,
				{
					role: 'assistant',
					content: result.response,
					...result.metadata
				},
				createAssistantMessage(
					'✅ **Modification Applied!**\n\nWould you like to make any other changes to:\n- Primary keyword\n- Secondary keywords\n- Title\n- Target location\n- Internal/External links\n- Reference materials\n\nJust tell me what to change, or say **"continue"** or **"done"** to regenerate the outline.'
				),
			]);

			setFlowContext((prev) => ({
				...prev,
				modificationInProgress: true,
				pendingModificationRequest: null,
			}));
		} catch (e: any) {
			setError(e?.message || 'Failed to process modification.');
			setFlowContext((prev) => ({
				...prev,
				modificationInProgress: false,
				pendingModificationRequest: null,
			}));
		} finally {
			setIsThinking(false);
		}

		return true;
	} else {
		setFlowContext((prev) => ({
			...prev,
			modificationInProgress: false,
			pendingModificationRequest: null,
		}));

		setMessages((prev) => [
			...prev,
			userMsg,
			createAssistantMessage(
				'👍 Got it! Continuing with the current blog setup.\n\nIf you need to make changes later, just let me know!'
			),
		]);
		return true;
	}
};

/**
 * Handles outline regeneration after modifications are complete
 * 
 * Regenerates the blog outline with updated information from modifications.
 * Runs the agent loop until outline is ready for approval.
 * 
 * @param agent - Current agent state
 * @param setters - State setters object
 * @param updateData - Function to update blog data
 * @param setMessages - Function to update messages
 * @param setIsThinking - Function to update thinking state
 * @param setIsStreaming - Function to update streaming state
 * @param setError - Function to set error message
 * @returns Promise<void>
 */
export const handleOutlineRegeneration = async (
	agent: AgentState,
	setters: AgentStateSetters & {
		setShowOutline: React.Dispatch<React.SetStateAction<boolean>>;
		setViewMode: React.Dispatch<
			React.SetStateAction<'outline' | 'blog' | 'markdown'>
		>;
		setShowBlogContent: React.Dispatch<React.SetStateAction<boolean>>;
	},
	updateData: (data: Partial<BlogData>) => void,
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
	setIsThinking: React.Dispatch<React.SetStateAction<boolean>>,
	setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>,
	setError: React.Dispatch<React.SetStateAction<string | null>>
): Promise<void> => {
	const regeneratingAgent: AgentState = {
		...agent,
		outline: [],
		outlineApproved: false,
		draft: '',
		finalBlogGenerated: false,
	};

	setIsThinking(true);

	try {
		let working = regeneratingAgent;
		const maxIterations = 100;
		let guard = 0;
		let lastTraceLength = 0;

		while (guard++ < maxIterations) {
			const { state: ns, halted } = await lgRunNext(working);
			working = ns;

			if (working.trace.length > lastTraceLength) {
				const latestTrace = working.trace[working.trace.length - 1];
				const stepMessage = getStepMessage(latestTrace.step, latestTrace.info);

				if (stepMessage) {
					// Turn off thinking indicator as soon as we start showing progress
					// This allows progress messages to be visible in real-time
					setIsThinking(false);
					
					setMessages((prev) => [
						...prev,
						createAssistantMessage(stepMessage),
					]);
					setIsStreaming(true);
					await new Promise((resolve) => setTimeout(resolve, 300));
				}
				lastTraceLength = working.trace.length;
			}

			updateAgentFromWorking(working, setters);

			if (
				halted &&
				working.halt?.reason === 'awaiting_approval' &&
				working.outline?.length > 0
			) {
				break;
			}

			if (halted && automationEngine.needsUserInput(ns)) {
				break;
			}
		}

		// Use optimized state update
		updateAllStateFromWorking(working, setters, updateData);

		if (working.outline?.length > 0 && working.halt?.reason === 'awaiting_approval') {
			setters.setShowOutline?.(true);
			setters.setViewMode?.('outline');
			setters.setOutlineApproved?.(false);
			setters.setShowBlogContent?.(false);

			setMessages((prev) => [
				...prev,
				createOutlineApprovalMessage(working.outline || []),
			]);
		}
	} catch (e: any) {
		setError(e?.message || 'Failed to regenerate outline.');
	} finally {
		setIsThinking(false);
	}
};

/**
 * Handles additional modifications while already in modification mode
 * 
 * Processes user's modification request directly without asking for confirmation
 * since user is already in modification mode. Applies changes and keeps user in
 * modification mode for further changes.
 * 
 * @param input - User's modification request
 * @param agent - Current agent state
 * @param flowContext - Flow context state
 * @param apiKey - API key for agent operations
 * @param userMsg - User message object
 * @param setAgent - Function to update agent state
 * @param setOutlineApproved - Function to update outline approval status
 * @param setOutline - Function to update outline
 * @param setDraft - Function to update draft content
 * @param setShowBlogContent - Function to show/hide blog content
 * @param setInput - Function to clear input
 * @param setIsThinking - Function to update thinking state
 * @param setError - Function to set error message
 * @param updateData - Function to update blog data
 * @param setUserTopic - Function to update user topic
 * @param setTargetLocation - Function to update target location
 * @param setMessages - Function to update messages
 * @param setFlowContext - Function to update flow context
 * @returns Promise<void>
 */
export const handleAdditionalModification = async (
	input: string,
	agent: AgentState,
	flowContext: FlowContext,
	apiKey: string,
	userMsg: ChatMessage,
	setAgent: React.Dispatch<React.SetStateAction<AgentState | null>>,
	setOutlineApproved: React.Dispatch<React.SetStateAction<boolean>>,
	setOutline: React.Dispatch<React.SetStateAction<any[]>>,
	setDraft: React.Dispatch<React.SetStateAction<string>>,
	setShowBlogContent: React.Dispatch<React.SetStateAction<boolean>>,
	setInput: React.Dispatch<React.SetStateAction<string>>,
	setIsThinking: React.Dispatch<React.SetStateAction<boolean>>,
	setError: React.Dispatch<React.SetStateAction<string | null>>,
	updateData: (data: Partial<BlogData>) => void,
	setUserTopic: React.Dispatch<React.SetStateAction<string>>,
	setTargetLocation: React.Dispatch<React.SetStateAction<string>>,
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
	setFlowContext: React.Dispatch<React.SetStateAction<FlowContext>>
): Promise<void> => {
	const modificationRequest = input.trim();
	const modifiedAgent = createModifiedAgentForRegeneration(agent);

	setAgent(modifiedAgent);
	setOutlineApproved(false);
	setOutline([]);
	setDraft('');
	setShowBlogContent(false);
	setInput('');
	setIsThinking(true);

	try {
		const modificationResponse = await conversationHandler.processMessage(
			modificationRequest,
			modifiedAgent,
			apiKey,
			flowContext.automationLevel
		);

		const updatedAgent = {
			...modifiedAgent,
			...modificationResponse.stateUpdates,
		};
		setAgent(updatedAgent);

		if (modificationResponse.stateUpdates?.data) {
			const updatedData = modificationResponse.stateUpdates.data;
			updateData({ ...updatedData });

			if (updatedData.topic) setUserTopic(updatedData.topic);
			if (updatedData.targetLocation) {
				setTargetLocation(updatedData.targetLocation);
			}
		}

		setMessages((prev) => [
			...prev,
			userMsg,
			createAssistantMessage(modificationResponse.assistantMessage),
			createAssistantMessage(
				'✅ **Modification Applied!**\n\nWould you like to make any other changes?\n\n- To modify more, just tell me what to change\n- Or say **"continue"** or **"done"** to regenerate the outline'
			),
		]);

		setFlowContext((prev) => ({
			...prev,
			modificationInProgress: true,
			pendingModificationRequest: null,
		}));
	} catch (e: any) {
		setError(e?.message || 'Failed to process modification.');
	} finally {
		setIsThinking(false);
	}
};

