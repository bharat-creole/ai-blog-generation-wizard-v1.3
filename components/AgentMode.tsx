import React, { useCallback, useEffect } from 'react';
import { AgentState } from '../services/langgraph/agentGraph';
import { useAgentExecutionV3 } from './agentComponents/hooks/useAgentExecutionV3';
import Spinner from './common/Spinner';
import { BlogData, Interlink, AutomationLevel, ChatMessage } from '../types';

// Extracted components
import SettingsPanel from './agentComponents/panels/SettingsPanel';
import BlogInfoPanel from './agentComponents/panels/BlogInfoPanel';
import TracePanel from './agentComponents/panels/TracePanel';
import { ChatInterface } from './agentComponents/chat/ChatInterface';
import { BlogContentDisplay } from './agentComponents/content/BlogContentDisplay';

// Extracted hooks
import { useAgentState } from './agentComponents/hooks/useAgentState';
import { useIntentAnalysis } from './agentComponents/hooks/useIntentAnalysis';

// Extracted handlers
import {
	handleModificationConfirmation,
	handleOutlineRegeneration,
	handleAdditionalModification,
} from './agentComponents/handlers/modificationFlowHandler';

// Extracted utilities
import {
	extractTopicFromText,
	findTopicInHistory,
	validateTopic,
} from './agentComponents/utils/topicExtraction';
import { createUserMessage } from './agentComponents/utils/messageUtils';
import { initializeAgentState } from './agentComponents/utils/agentStateUtils';

// Styles
import { markdownStyles } from './agentComponents/styles/agentModeStyles';

interface Props {
	data: BlogData;
	updateData: (data: Partial<BlogData>) => void;
	showBlogInfo: boolean;
	showTrace: boolean;
	showSettings: boolean;
	onCollapseSidebar?: () => void;
}

const AgentMode: React.FC<Props> = ({
	data,
	updateData,
	showBlogInfo,
	showTrace,
	showSettings,
	onCollapseSidebar,
}) => {
	const apiKey = data.apiKey;
	const interlinks: Interlink[] = data.interlinks;

	// Use extracted hooks for state management
	const agentState = useAgentState(data, apiKey);
	const {
		flowContext,
		setFlowContext,
		messages,
		setMessages,
		input,
		setInput,
		draft,
		setDraft,
		userTopic,
		setUserTopic,
		targetLocation,
		setTargetLocation,
		outline,
		setOutline,
		outlineApproved,
		setOutlineApproved,
		showBlogContent,
		setShowBlogContent,
		isThinking,
		setIsThinking,
		isStreaming,
		setIsStreaming,
		error,
		setError,
		traceItems,
		setTraceItems,
		seoScore,
		setSeoScore,
		seoPrimary,
		setSeoPrimary,
		seoCritical,
		setSeoCritical,
		isRanking,
		setIsRanking,
		agent,
		setAgent,
		selectedSecondaries,
		setSelectedSecondaries,
		viewMode,
		setViewMode,
		showOutline,
		setShowOutline,
		interlinkKeyword,
		setInterlinkKeyword,
		interlinkUrl,
		setInterlinkUrl,
		currentReferenceUrl,
		setCurrentReferenceUrl,
		completedSelections,
		setCompletedSelections,
		scrollRef,
		canSend,
		isInputLocked,
	} = agentState;

	// Use intent analysis hook
	const { analyzeUserIntent } = useIntentAnalysis();

	// Use agent execution hook with setters for real-time updates
	const { sendUserMessage } = useAgentExecutionV3(
		setMessages,
		setIsStreaming,
		setIsThinking,
		{
			setDraft,
			setAgent,
			setOutline,
			updateData,
		}
	);

	// Set streaming to true on mount for initial assistant message
	useEffect(() => {
		setIsStreaming(true);
	}, []);

	useEffect(() => {
		scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages, isThinking]);

	// Show blog content when draft or outline is approved
	useEffect(() => {
		if (outlineApproved && draft.trim().length > 0) {
			setShowBlogContent(true);
		}
	}, [outlineApproved, draft]);

	// ✨ FIX: Clear completedSelections when jumping back to a selection step
	// This allows re-selection when user modifies their choices
	useEffect(() => {
		if (!agent?.halt?.reason) return;

		const haltToSelectionMap: Record<string, string> = {
			await_keyword_selection: 'primaryKeyword',
			await_secondary_selection: 'secondaryKeywords',
			await_title_selection: 'title',
			awaiting_approval: 'outline',
		};

		const selectionKey = haltToSelectionMap[agent.halt.reason];

		// If we're at a step that has a completed selection, clear it
		// This allows re-selection when user goes back
		if (selectionKey && completedSelections.has(selectionKey)) {
			console.log(
				`🔄 [UI FIX] Clearing completed selection for: ${selectionKey} (halt reason: ${agent.halt.reason})`
			);
			setCompletedSelections((prev) => {
				const newSet = new Set(prev);
				newSet.delete(selectionKey);
				return newSet;
			});
		}
	}, [agent?.halt?.reason, completedSelections, setCompletedSelections]);

	// Removed SEO ranking feature

	const handleSend = useCallback(async () => {
		if (!canSend) return;
		if (!apiKey) {
			setError('Please set your Gemini API Key in Settings.');
			return;
		}
		setError(null);
		const userMsg = createUserMessage(input.trim());

		// Use extracted intent analysis
		const intent = analyzeUserIntent(input.trim());

		let messageSentToBackend = false; // Flag to prevent duplicate backend calls

		// Handle general blog generation requests (generate blog, create blog, write blog, etc.)
		if (intent.wantsBlogGeneration && !agent) {
			// Try to extract topic from current message
			let topicFound = extractTopicFromText(input.trim());

			// If no topic in current message, check previous messages
			if (!topicFound) {
				topicFound = findTopicInHistory(messages, intent);
			}

			// Check existing data
			const existingTopic = userTopic || data.topic;

			if (!topicFound && !existingTopic) {
				// No topic found anywhere - ask for it
				setFlowContext((prev) => ({
					...prev,
					automationLevel: 'guided',
					currentStep: 'awaiting_topic',
					userRequestedAutomation: false,
				}));

				setMessages((prev) => [
					...prev,
					userMsg,
					{
						role: 'assistant',
						content: "I'd be happy to help you create a blog post! 📝\n\n**Please tell me what topic you'd like to write about:**\n\nFor example:\n- 'AI in healthcare'\n- 'Benefits of remote work'\n- 'Best practices for web development'\n\nWhat's your blog topic?",
					},
				]);
				setInput('');
				return;
			} else {
				// Topic found - use it and start guided generation
				const finalTopic = topicFound || existingTopic;
				if (topicFound && !existingTopic) {
					setUserTopic(topicFound);
				}

				setFlowContext((prev) => ({
					...prev,
					automationLevel: 'guided',
					currentStep: 'processing',
					hasProvidedInfo: true,
				}));

				setMessages((prev) => [
					...prev,
					userMsg,
					{
						role: 'assistant',
						content: `Great! I'll help you create a blog post about **"${finalTopic}"**.\n\nLet me start by researching keywords and generating an outline. I'll ask for your approval at key steps.`,
					},
				]);

				messageSentToBackend = true; // Mark that user message was already added
				// Continue to backend execution below...
			}
		}

		// If user was asked for topic and now provides it
		if (
			!agent &&
			flowContext.currentStep === 'awaiting_topic' &&
			!intent.wantsFullAutomation &&
			!intent.wantsBlogGeneration &&
			!intent.isIrrelevant
		) {
			const providedText = input.trim();

			// Validate if the input is a valid topic (not just any text)
			const isValidTopic = validateTopic(providedText, intent);

			if (!isValidTopic) {
				// Input doesn't look like a valid topic
				setMessages((prev) => [
					...prev,
					userMsg,
					{
						role: 'assistant',
						content: "I need a clear blog topic to proceed. Please provide a specific topic.\n\n**Examples:**\n- 'The impact of AI on modern education'\n- 'Best practices for remote team management'\n- 'How to build a successful e-commerce business'\n\nWhat would you like to write about?",
					},
				]);
				setInput('');
				return;
			}

			// User is providing a valid topic after being asked
			setUserTopic(providedText);

			// Determine if this was for automation or guided mode
			const isForAutomation = flowContext.userRequestedAutomation;

			setFlowContext((prev) => ({
				...prev,
				automationLevel: isForAutomation ? 'full' : 'guided',
				currentStep: isForAutomation
					? 'automation'
					: 'processing',
				hasProvidedInfo: true,
			}));

			// Continue to backend execution below
		}

		// Handle "generate blog automatically" with data analysis
		if (intent.wantsFullAutomation && !agent) {
			// Try to extract topic from the user's message
			const extractedTopic = input
				.trim()
				.replace(
					/^(generate|create|write|make).*(blog|article|post|content).*(about|on|for|regarding|concerning)\s+/i,
					''
				)
				.replace(
					/^(generate|create|write|make).*(automatically|auto).*$/i,
					''
				)
				.trim();

			// Check if user provided topic in the same message
			const topicInMessage =
				extractedTopic.length > 10 &&
				extractedTopic !== input.trim() &&
				!/^(generate|create|write|make|automatically|auto)/i.test(
					extractedTopic
				);

			// Analyze what data we already have
			const hasExistingData = {
				topic: !!(userTopic || data.topic || topicInMessage),
				primaryKeyword: !!data.primaryKeyword,
				secondaryKeywords:
					(data.secondaryKeywords || []).length > 0,
				title: !!data.title,
				references: (data.referenceUrls || []).length > 0,
				interlinks: (data.interlinks || []).length > 0,
			};

			const currentTopic =
				userTopic ||
				data.topic ||
				(topicInMessage ? extractedTopic : '');
			const hasValidTopic = currentTopic.trim().length >= 3;

			// Check if topic is clear before proceeding
			if (!hasValidTopic) {
				// No clear topic - must ask before starting
				setFlowContext((prev) => ({
					...prev,
					automationLevel: 'full',
					currentStep: 'awaiting_topic',
					userRequestedAutomation: true,
				}));

				setMessages((prev) => [
					...prev,
					userMsg,
					{
						role: 'assistant',
						content: '🚀 **Full Automation Mode Activated!**\n\nI\'ll handle everything for you and create an SEO-optimized blog post.\n\n**To get started, please provide your blog topic:**\n\nFor example:\n- "AI in healthcare"\n- "Benefits of remote work"\n- "Best practices for web development"\n\n💡 *Tip: Be specific about your topic for better results!*',
					},
				]);
				setInput('');
				return;
			} else {
				// Has a valid topic - save it if extracted from message
				if (topicInMessage && !userTopic && !data.topic) {
					setUserTopic(extractedTopic);
				}

				// Has a valid topic - check if there's other data
				// Has some data - analyze and resume from there
				let dataStatus =
					'🎯 **Analyzing your existing data...**\n\n';
				if (hasExistingData.topic)
					dataStatus += `✅ Topic: ${currentTopic} \n`;
				if (hasExistingData.primaryKeyword)
					dataStatus += `✅ Primary Keyword: ${data.primaryKeyword} \n`;
				if (hasExistingData.secondaryKeywords)
					dataStatus += `✅ Secondary Keywords: ${data.secondaryKeywords.join(
						', '
					)} \n`;
				if (hasExistingData.title)
					dataStatus += `✅ Title: ${data.title} \n`;
				if (hasExistingData.references)
					dataStatus += `✅ References: ${data.referenceUrls.length} link(s) \n`;
				if (hasExistingData.interlinks)
					dataStatus += `✅ Internal Links: ${data.interlinks.length} link(s) \n`;

				dataStatus +=
					"\n**Switching to Full Automation Mode...**\n\nI'll use this information and auto-generate the remaining content!";

				// Switch to full automation mode and continue
				setFlowContext((prev) => ({
					...prev,
					automationLevel: 'full',
					currentStep: 'automation_with_data',
					userRequestedAutomation: true,
				}));

				setMessages((prev) => [
					...prev,
					userMsg,
					{
						role: 'assistant',
						content: dataStatus,
					},
				]);
				messageSentToBackend = true; // Mark that user message was already added
				setInput('');
				setIsThinking(true);

				// Continue to backend execution below...
			}
		} else if (intent.wantsFullAutomation && agent) {
			// User wants full automation but agent already exists - update preferences
			setFlowContext((prev) => ({
				...prev,
				automationLevel: 'full',
				currentStep: 'automation',
				userRequestedAutomation: true,
			}));

			// Update agent preferences to full automation
			const updatedAgent: AgentState = {
				...agent,
				preferences: {
					...agent.preferences,
					automationLevel: 'full' as AutomationLevel,
					skipOptionalSteps: true,
					autoSelectBestOptions: true,
				},
			};

			// Update the agent state
			setAgent(updatedAgent);

			setMessages((prev) => [
				...prev,
				userMsg,
				{
					role: 'assistant',
					content: "🚀 **Switched to Full Automation Mode!**\n\nI'll handle all remaining steps automatically. No more questions - let me complete your blog!",
				},
			]);
			messageSentToBackend = true; // Mark that user message was already added
			setInput('');
			setIsThinking(true);

			// Continue to backend execution below...
		}

		// Handle automation during guided flow
		if (intent.wantsAutomation && agent) {
			// Update context to full automation
			setFlowContext((prev) => ({
				...prev,
				automationLevel: 'full',
				userRequestedAutomation: true,
			}));

			// Update agent preferences
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
				{
					role: 'assistant',
					content: "🔄 **Switching to Automation Mode**\n\nI'll handle all remaining steps automatically without asking questions. Let me complete your blog!",
				},
			]);
			messageSentToBackend = true; // Mark that user message was already added
			setInput('');
			setIsThinking(true);

			// Continue to backend execution below...
		} else if (!messageSentToBackend) {
			// Only add user message if not already handled by a specific flow
			// Normal message flow
			setMessages((prev) => [...prev, userMsg]);
			setInput('');
		}

		// V3: Send message to backend instead of using local handlers
		try {
			setIsThinking(true);

			// Build current state
			// If we just updated agent locally (e.g. for automation), use that
			// Otherwise initialize or use existing
			let stateToUse = agent;

			if (!stateToUse) {
				stateToUse = initializeAgentState(
					data,
					userTopic || '',
					targetLocation || 'United States',
					draft || '',
					messages,
					apiKey,
					flowContext.automationLevel || 'guided'
				);
			}

			// Ensure apiKey is set
			const currentState: AgentState = {
				...stateToUse,
				apiKey,
			};

			// Send message to backend
			const result = await sendUserMessage(
				input.trim(),
				currentState
			);

			// Display assistant response
			setMessages((prev) => [
				...prev,
				{
					role: 'assistant',
					content: result.response,
					...result.metadata, // ✨ Attach UI metadata (options, forms, etc.)
				},
			]);

			// Update local state with backend response
			setAgent(result.updatedState);
			setOutline(result.updatedState.outline);
			setDraft(result.updatedState.draft);
			setOutlineApproved(result.updatedState.outlineApproved);
			setUserTopic(result.updatedState.data.topic || userTopic);
			setTraceItems(
				result.updatedState.trace.map((t) => ({
					step: t.step,
					at: t.at,
				}))
			);

			// Sync to parent data
			updateData({
				topic: result.updatedState.data.topic,
				primaryKeyword: result.updatedState.data.primaryKeyword,
				secondaryKeywords:
					result.updatedState.data.secondaryKeywords,
				outline: result.updatedState.outline,
				blogContent: result.updatedState.draft,
				targetLocation: result.updatedState.data.targetLocation,
			});

			// If outline was approved, switch to blog content view
			if (result.updatedState.outlineApproved && !outlineApproved) {
				setOutlineApproved(true);
				setShowBlogContent(true);
				setViewMode('markdown');
				if (onCollapseSidebar) {
					onCollapseSidebar();
				}
			}
		} catch (e: any) {
			setError(e?.message || 'Agent failed to respond.');
		} finally {
			setIsThinking(false);
		}
	}, [
		agent,
		apiKey,
		canSend,
		data,
		draft,
		messages,
		input,
		updateData,
		userTopic,
		targetLocation,
		flowContext,
		outline,
		outlineApproved,
		sendUserMessage,
		setAgent,
		setCompletedSelections,
		setDraft,
		setError,
		setFlowContext,
		setIsStreaming,
		setIsThinking,
		setMessages,
		setOutline,
		setOutlineApproved,
		setShowBlogContent,
		setInput,
		setTargetLocation,
		setTraceItems,
		setUserTopic,
		setViewMode,
		onCollapseSidebar,
	]);

	return (
		<div className='h-full flex flex-col overflow-hidden'>
			{/* Inject markdown styles */}
			<style>{markdownStyles}</style>

			<div className='flex-1 flex flex-col overflow-hidden'>
				{error && (
					<div
						className='bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4'
						role='alert'
					>
						{error}
					</div>
				)}

				<BlogInfoPanel
					show={showBlogInfo}
					agent={agent}
				/>

				<TracePanel
					show={showTrace}
					traceItems={traceItems}
				/>

				<SettingsPanel
					show={showSettings}
					data={data}
					updateData={updateData}
				/>

				{/* Debug indicator - remove in production */}
				{showBlogContent && (
					<div className='text-xs text-green-600 font-bold mb-2'>
						✅ Blog History
					</div>
				)}

				<div className='flex gap-4 flex-1 min-h-0 transition-all duration-700 ease-in-out'>
					{/* Chat + Input */}
					<ChatInterface
						messages={messages}
						agent={agent}
						data={data}
						selectedSecondaries={selectedSecondaries}
						completedSelections={completedSelections}
						input={input}
						setInput={setInput}
						canSend={canSend}
						isInputLocked={isInputLocked}
						outlineApproved={outlineApproved}
						isStreaming={isStreaming}
						isThinking={isThinking}
						setSelectedSecondaries={
							setSelectedSecondaries
						}
						setCompletedSelections={
							setCompletedSelections
						}
						setMessages={setMessages}
						setAgent={setAgent}
						updateData={updateData}
						setIsThinking={setIsThinking}
						setOutline={setOutline}
						setDraft={setDraft}
						setTraceItems={setTraceItems}
						setOutlineApproved={setOutlineApproved}
						setViewMode={setViewMode}
						setIsStreaming={setIsStreaming}
						onSend={handleSend}
						scrollRef={scrollRef}
						showBlogContent={showBlogContent}
						setShowBlogContent={setShowBlogContent}
						onCollapseSidebar={onCollapseSidebar}
						sendUserMessage={sendUserMessage}
					/>

					{/* Draft + SEO */}
					{showBlogContent && (
						<BlogContentDisplay
							draft={draft}
							viewMode={viewMode}
							setViewMode={setViewMode}
							setDraft={setDraft}
							isThinking={isThinking}
							seoScore={seoScore}
							seoPrimary={seoPrimary}
							seoCritical={seoCritical}
							isRanking={isRanking}
						/>
					)}
				</div>
			</div>
		</div>
	);
};

export default AgentMode;
