import { ChatMessage, AutomationLevel } from '../../../types';
import { AgentState } from '../../../../server/agent/state';
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
// Helper function to get "before step" message based on current step
const getBeforeStepMessage = (currentStep: string | undefined): string | null => {
	if (!currentStep) return null;
	
	const messages: Record<string, string> = {
		'primary_keyword': '🔍 **Researching primary keywords...**\n\nI\'m analyzing your topic to find the best primary keyword options for SEO optimization.',
		'secondary_keywords': '🔍 **Generating secondary keywords...**\n\nI\'m finding related keywords that complement your primary keyword to expand your content\'s reach.',
		'title': '📝 **Generating title options...**\n\nI\'m creating engaging title options that incorporate your keywords and appeal to your target audience.',
		'outline': '📋 **Generating outline...**\n\nI\'m creating a comprehensive outline structure for your blog post.',
		'generation': '✍️ **Writing blog content...**\n\nI\'m generating the full blog post based on your outline.',
	};
	
	return messages[currentStep] || null;
};

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
		let lastStep: string | undefined = working.currentStep;
		const shownBeforeStepMessages = new Set<string>();

		while (guard++ < maxIterations) {
			const { state: ns, halted } = await lgRunNext(working);
			working = ns;

			// Check if we've moved to a new step and show "before step" message
			if (working.currentStep && working.currentStep !== lastStep) {
				const beforeStepMsg = getBeforeStepMessage(working.currentStep);
				if (beforeStepMsg && !shownBeforeStepMessages.has(working.currentStep)) {
					setMessages((prev) => [
						...prev,
						createAssistantMessage(beforeStepMsg),
					]);
					setIsStreaming(true);
					shownBeforeStepMessages.add(working.currentStep);
					await new Promise((resolve) => setTimeout(resolve, 200));
				}
				lastStep = working.currentStep;
			}

			// Update live state FIRST (before progress messages) so content appears immediately
			// This ensures draft updates happen in real-time as content is generated section by section
			updateAgentFromWorking(working, setters);

			// Show progress messages from trace steps
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
		// Only turn off loader when automation is completely done
		setIsThinking(false);
	}
};

