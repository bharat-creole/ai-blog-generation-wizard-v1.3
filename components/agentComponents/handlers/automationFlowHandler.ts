import { ChatMessage, AutomationLevel } from '../../../types';
import { AgentState } from '../../../services/langgraph/agentGraph';
import { FlowContext } from '../types/agentTypes';
import { createAssistantMessage } from '../utils/messageUtils';
import { updateAgentFromWorking, updateAllStateFromWorking, AgentStateSetters } from '../utils/agentStateUtils';
import { runNext as lgRunNext } from '../../../services/langgraph/agentGraph';
import * as automationEngine from '../../../services/automationEngine';
import { getStepMessage } from '../utils/agentHelpers';
import { shouldShowProgressMessage } from '../utils/messageUtils';

/**
 * Switches agent to full automation mode
 */
export const switchToAutomationMode = (
	agent: AgentState,
	setFlowContext: React.Dispatch<React.SetStateAction<FlowContext>>,
	setAgent: React.Dispatch<React.SetStateAction<AgentState | null>>,
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
	userMsg: ChatMessage
): AgentState => {
	setFlowContext((prev) => ({
		...prev,
		automationLevel: 'full',
		userRequestedAutomation: true,
	}));

	const updatedAgent: AgentState = {
		...agent,
		preferences: {
			...agent.preferences,
			automationLevel: 'full' as AutomationLevel,
			skipOptionalSteps: true,
			autoSelectBestOptions: true,
		},
	};

	setAgent(updatedAgent);

	setMessages((prev) => [
		...prev,
		userMsg,
		createAssistantMessage(
			"🔄 **Switching to Automation Mode**\n\nI'll handle all remaining steps automatically without asking questions. Let me complete your blog!"
		),
	]);

	return updatedAgent;
};

/**
 * Runs agent in full automation mode
 * 
 * Executes the agent loop with full automation enabled, handling all steps
 * automatically without user input. Updates state and shows progress messages.
 * 
 * @param agent - Agent state with full automation preferences
 * @param setters - State setters object
 * @param updateData - Function to update blog data
 * @param setMessages - Function to update messages
 * @param setIsThinking - Function to update thinking state
 * @param setIsStreaming - Function to update streaming state
 * @param setError - Function to set error message
 * @param onCollapseSidebar - Optional callback to collapse sidebar
 * @returns Promise<AgentState> - Final agent state after automation
 */
export const runAutomationFlow = async (
	agent: AgentState,
	setters: AgentStateSetters & {
		setShowBlogContent: React.Dispatch<React.SetStateAction<boolean>>;
		setViewMode: React.Dispatch<
			React.SetStateAction<'outline' | 'blog' | 'markdown'>
		>;
		setOutlineApproved: React.Dispatch<React.SetStateAction<boolean>>;
	},
	updateData: (data: Partial<any>) => void,
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
	setIsThinking: React.Dispatch<React.SetStateAction<boolean>>,
	setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>,
	setError: React.Dispatch<React.SetStateAction<string | null>>,
	onCollapseSidebar?: () => void
): Promise<AgentState> => {
	setIsThinking(true);

	try {
		let working = agent;
		const maxIterations = 100;
		let guard = 0;
		let lastTraceLength = 0;

		while (guard++ < maxIterations) {
			const { state: ns, halted } = await lgRunNext(working);
			working = ns;

			// Update live state FIRST (before progress messages) so content appears immediately
			// This ensures draft updates happen in real-time as content is generated section by section
			updateAgentFromWorking(working, setters);

			// Show progress messages
			if (shouldShowProgressMessage(working.trace.length, lastTraceLength)) {
				const latestTrace = working.trace[working.trace.length - 1];
				const stepMessage = getStepMessage(latestTrace.step, latestTrace.info);

				if (stepMessage) {
					setMessages((prev) => [
						...prev,
						createAssistantMessage(stepMessage),
					]);
					setIsStreaming(true);
					await new Promise((resolve) => setTimeout(resolve, 300));
				}
				lastTraceLength = working.trace.length;
			}

			// If outline was auto-approved, switch to blog content view
			if (working.outlineApproved) {
				setters.setOutlineApproved?.(true);
				setters.setShowBlogContent?.(true);
				setters.setViewMode?.('markdown');
				if (onCollapseSidebar) {
					onCollapseSidebar();
				}
			}

			// Only halt if user input is actually needed (shouldn't happen in full automation)
			if (halted && automationEngine.needsUserInput(ns)) {
				break;
			}
		}

		// Final state update (optimized)
		updateAllStateFromWorking(working, setters, updateData);

		// Check if blog generation is complete
		if (
			!working.halt &&
			(working.progress.sectionIndex ?? 0) >= (working.outline?.length || 0) &&
			(working.outline?.length || 0) > 0
		) {
			setMessages((prev) => [
				...prev,
				createAssistantMessage(
					'✨ Blog generation complete! Review your content in the Live Draft panel.'
				),
			]);
			setIsStreaming(true);
		}

		return working;
	} catch (e: any) {
		setError(e?.message || 'Agent failed to respond.');
		throw e;
	} finally {
		setIsThinking(false);
	}
};

