import { ChatMessage, BlogData, AutomationLevel } from '../../../types';
import { AgentState } from '../../../services/langgraph/agentGraph';
import * as conversationHandler from '../../../services/conversationHandler';
import { FlowContext } from '../types/agentTypes';
import {
	initializeAgentState,
	updateAgentFromWorking,
	syncAgentStateToData,
	updateAllStateFromWorking,
	AgentStateSetters,
} from '../utils/agentStateUtils';
import {
	createAssistantMessage,
	createOutlineApprovalMessage,
	createKeywordSelectionMessage,
	createTitleSelectionMessage,
	createInterlinkingFormMessage,
	createReferencesFormMessage,
} from '../utils/messageUtils';
import { runNext as lgRunNext } from '../../../services/langgraph/agentGraph';
import * as automationEngine from '../../../services/automationEngine';
import { getStepMessage } from '../utils/agentHelpers';
import { shouldShowProgressMessage } from '../utils/messageUtils';

/**
 * Initializes agent state for blog generation
 */
export const initializeBlogGeneration = (
	data: BlogData,
	userTopic: string,
	targetLocation: string,
	draft: string,
	messages: ChatMessage[],
	userMsg: ChatMessage,
	apiKey: string,
	flowContext: FlowContext,
	agent: AgentState | null
): AgentState => {
	return (
		agent ??
		initializeAgentState(
			data,
			userTopic,
			targetLocation,
			draft,
			messages.concat(userMsg),
			apiKey,
			flowContext.automationLevel
		)
	);
};

/**
 * Creates setup messages based on flow context
 */
export const createSetupMessages = (
	flowContext: FlowContext,
	userTopic: string,
	data: BlogData,
	userMsg: ChatMessage,
	conversationResponse: any,
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
): void => {
	const isAutomationTopicSetup =
		flowContext.userRequestedAutomation &&
		flowContext.currentStep === 'automation' &&
		flowContext.hasProvidedInfo;

	const isGuidedTopicSetup =
		!flowContext.userRequestedAutomation &&
		flowContext.currentStep === 'processing' &&
		flowContext.hasProvidedInfo;

	const isAutomationWithData =
		flowContext.userRequestedAutomation &&
		flowContext.currentStep === 'automation_with_data';

	if (isAutomationTopicSetup) {
		const currentTopic = userTopic || userMsg.content;
		setMessages((prev) => [
			...prev,
			createAssistantMessage(
				`🚀 **Perfect! Starting Full Automation...**\n\n**Topic:** ${currentTopic}\n\nI'll now auto-generate all the content for you. Sit back and watch the magic happen!`
			),
		]);
	} else if (isAutomationWithData) {
		const hasExistingData = {
			topic: !!(userTopic || data.topic),
			primaryKeyword: !!data.primaryKeyword,
			secondaryKeywords: (data.secondaryKeywords || []).length > 0,
			title: !!data.title,
			references: (data.referenceUrls || []).length > 0,
			interlinks: (data.interlinks || []).length > 0,
		};

		let dataStatus = '🎯 **Analyzing your existing data...**\n\n';
		if (hasExistingData.topic)
			dataStatus += `✅ Topic: ${userTopic || data.topic}\n`;
		if (hasExistingData.primaryKeyword)
			dataStatus += `✅ Primary Keyword: ${data.primaryKeyword}\n`;
		if (hasExistingData.secondaryKeywords)
			dataStatus += `✅ Secondary Keywords: ${data.secondaryKeywords.join(', ')}\n`;
		if (hasExistingData.title) dataStatus += `✅ Title: ${data.title}\n`;
		if (hasExistingData.references)
			dataStatus += `✅ References: ${data.referenceUrls.length} link(s)\n`;
		if (hasExistingData.interlinks)
			dataStatus += `✅ Internal Links: ${data.interlinks.length} link(s)\n`;

		dataStatus +=
			"\n**Switching to Full Automation Mode...**\n\nI'll use this information and auto-generate the remaining content!";

		setMessages((prev) => [
			...prev,
			createAssistantMessage(dataStatus),
		]);
	} else if (isGuidedTopicSetup) {
		const currentTopic = userTopic || userMsg.content;
		setMessages((prev) => [
			...prev,
			createAssistantMessage(
				`Great! I'll help you create a blog post about **"${currentTopic}"**.\n\nLet me start by researching keywords and generating an outline. I'll ask for your approval at key steps.`
			),
		]);
	} else {
		setMessages((prev) => [
			...prev,
			createAssistantMessage(conversationResponse.assistantMessage),
		]);
	}
};

/**
 * Runs the agent execution loop for blog generation
 */
export const runBlogGenerationLoop = async (
	working: AgentState,
	flowContext: FlowContext,
	setters: AgentStateSetters & {
		setShowBlogContent: React.Dispatch<React.SetStateAction<boolean>>;
		setViewMode: React.Dispatch<
			React.SetStateAction<'outline' | 'blog' | 'markdown'>
		>;
		setOutlineApproved: React.Dispatch<React.SetStateAction<boolean>>;
	},
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
	setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>,
	onCollapseSidebar?: () => void
): Promise<AgentState> => {
	const maxIterations =
		working.preferences?.automationLevel === 'full' ? 100 : 20;
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

		// Only halt if user input is actually needed
		if (halted && automationEngine.needsUserInput(ns)) {
			break;
		}
	}

	return working;
};

/**
 * Creates halt messages for guided/manual mode
 */
export const createHaltMessages = (
	working: AgentState,
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
	setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>
): void => {
	if (working.preferences?.automationLevel === 'full') return;

	if (working.halt?.reason === 'await_keyword_selection') {
		setMessages((prev) => [
			...prev,
			createKeywordSelectionMessage(
				'primary',
				working.keywordResearch?.primaryCandidates || []
			),
		]);
	} else if (working.halt?.reason === 'await_secondary_selection') {
		setMessages((prev) => [
			...prev,
			createKeywordSelectionMessage(
				'secondary',
				working.keywordResearch?.secondaryCandidates || []
			),
		]);
	} else if (working.halt?.reason === 'await_title_selection') {
		if (working.titleOptions && working.titleOptions.length > 0) {
			setMessages((prev) => [
				...prev,
				createTitleSelectionMessage(working.titleOptions),
			]);
		}
	} else if (working.halt?.reason === 'await_interlinking') {
		setMessages((prev) => [
			...prev,
			createInterlinkingFormMessage(working.data.interlinks || []),
		]);
	} else if (working.halt?.reason === 'await_references') {
		setMessages((prev) => [
			...prev,
			createReferencesFormMessage(
				working.data.referenceUrls || [],
				working.data.referenceFiles || []
			),
		]);
	} else if (working.halt?.reason === 'references_not_used') {
		setMessages((prev) => [
			...prev,
			createAssistantMessage(
				'⚠️ References were not used in the last section. Provide alternative links or proceed without them.'
			),
		]);
		setIsStreaming(true);
	}
};

/**
 * Main blog generation flow handler
 */
export const handleBlogGeneration = async (
	data: BlogData,
	userTopic: string,
	targetLocation: string,
	draft: string,
	messages: ChatMessage[],
	userMsg: ChatMessage,
	apiKey: string,
	flowContext: FlowContext,
	agent: AgentState | null,
	setters: AgentStateSetters & {
		setShowBlogContent: React.Dispatch<React.SetStateAction<boolean>>;
		setViewMode: React.Dispatch<
			React.SetStateAction<'outline' | 'blog' | 'markdown'>
		>;
		setOutlineApproved: React.Dispatch<React.SetStateAction<boolean>>;
	},
	updateData: (data: Partial<BlogData>) => void,
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
	setIsThinking: React.Dispatch<React.SetStateAction<boolean>>,
	setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>,
	setError: React.Dispatch<React.SetStateAction<string | null>>,
	onCollapseSidebar?: () => void
): Promise<AgentState> => {
	setIsThinking(true);

	try {
		// Initialize agent state
		let working = initializeBlogGeneration(
			data,
			userTopic,
			targetLocation,
			draft,
			messages,
			userMsg,
			apiKey,
			flowContext,
			agent
		);

		// Process message with conversation handler
		const conversationResponse = await conversationHandler.processMessage(
			userMsg.content,
			working,
			apiKey,
			flowContext.automationLevel
		);

		// Create setup messages
		createSetupMessages(flowContext, userTopic, data, userMsg, conversationResponse, setMessages);
		setIsStreaming(true);

		// Apply state updates from conversation handler
		working = {
			...working,
			...conversationResponse.stateUpdates,
		};

		// Run agent if conversation handler says so
		if (conversationResponse.shouldRunAgent) {
			working = await runBlogGenerationLoop(
				working,
				flowContext,
				setters,
				setMessages,
				setIsStreaming,
				onCollapseSidebar
			);
		}

		// Final state update (optimized)
		updateAllStateFromWorking(working, setters, updateData);

		// Show outline approval if needed
		if (working.halt?.reason === 'awaiting_approval') {
			setMessages((prev) => [
				...prev,
				createOutlineApprovalMessage(working.outline || []),
			]);
		}

		// Create halt messages for guided/manual mode
		createHaltMessages(working, setMessages, setIsStreaming);

		// Final completion message
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

