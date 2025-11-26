import React, { useCallback, useEffect } from 'react';
import * as agentService from '../services/agentService';
import {
	runNext as lgRunNext,
	AgentState,
} from '../services/langgraph/agentGraph';
import * as geminiService from '../services/geminiService';
import * as conversationHandler from '../services/conversationHandler';
import * as automationEngine from '../services/automationEngine';
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
import { useAgentExecution } from './agentComponents/hooks/useAgentExecution';

// Extracted handlers
import {
	handleModificationConfirmation,
	handleOutlineRegeneration,
	handleAdditionalModification,
} from './agentComponents/handlers/modificationFlowHandler';
import {
	switchToAutomationMode,
	runAutomationFlow,
} from './agentComponents/handlers/automationFlowHandler';
import { handleBlogGeneration } from './agentComponents/handlers/blogGenerationFlowHandler';

// Extracted utilities
import {
	fileToBase64,
	getStepMessage,
} from './agentComponents/utils/agentHelpers';
import {
	extractTopicFromText,
	findTopicInHistory,
	validateTopic,
} from './agentComponents/utils/topicExtraction';
import { createUserMessage } from './agentComponents/utils/messageUtils';
import {
	initializeAgentState,
	updateAgentFromWorking,
	syncAgentStateToData,
} from './agentComponents/utils/agentStateUtils';
import {
	createOutlineApprovalMessage,
	createKeywordSelectionMessage,
	createTitleSelectionMessage,
	createInterlinkingFormMessage,
	createReferencesFormMessage,
} from './agentComponents/utils/messageUtils';

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

	// Use agent execution hook
	const { runAgentLoop } = useAgentExecution(setMessages, setIsStreaming);

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

				// Continue with agent initialization below
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

			// Don't add userMsg here - let the general flow add it
			// Continue with agent initialization below
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

				// Don't add messages here - let the general flow handle it
				// Don't return - continue with agent initialization below
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
			setInput('');
			setIsThinking(true);

			// Don't return - continue with agent execution
			try {
				let working = updatedAgent;

				// Run agent with full automation
				const maxIterations = 100;
				let guard = 0;
				let lastTraceLength = 0;

				while (guard++ < maxIterations) {
					const {
						state: ns,
						halted,
						step,
					} = await lgRunNext(working);
					working = ns;

					// Show progress messages
					if (working.trace.length > lastTraceLength) {
						const latestTrace =
							working.trace[
								working.trace.length - 1
							];
						const stepMessage = getStepMessage(
							latestTrace.step,
							latestTrace.info
						);

						if (stepMessage) {
							setMessages((prev) => [
								...prev,
								{
									role: 'assistant',
									content: stepMessage,
								},
							]);
							setIsStreaming(true);

							await new Promise((resolve) =>
								setTimeout(resolve, 300)
							);
						}
						lastTraceLength = working.trace.length;
					}

					// Update live state
					setAgent(working);
					setDraft(working.draft);
					setOutline(working.outline);

					// If outline was auto-approved, switch to blog content view
					if (working.outlineApproved && !outlineApproved) {
						setOutlineApproved(true);
						setShowBlogContent(true);
						setViewMode('markdown');
						if (onCollapseSidebar) {
							onCollapseSidebar();
						}
					}

					// Only halt if user input is actually needed
					if (
						halted &&
						automationEngine.needsUserInput(ns)
					) {
						break;
					}
				}

				setAgent(working);
				setOutline(working.outline);
				setDraft(working.draft);
				setUserTopic(working.data.topic || '');
				setTargetLocation(
					working.data.targetLocation || 'United States'
				);
				setTraceItems(
					working.trace.map((t) => ({
						step: t.step,
						at: t.at,
					}))
				);
				updateData({
					outline: working.outline,
					blogContent: working.draft,
					primaryKeyword: working.data.primaryKeyword,
					secondaryKeywords: working.data.secondaryKeywords,
					topic: working.data.topic,
					targetLocation: working.data.targetLocation,
				});

				// Check if blog generation is complete
				if (
					!working.halt &&
					(working.progress.sectionIndex ?? 0) >=
						(working.outline?.length || 0) &&
					(working.outline?.length || 0) > 0
				) {
					setMessages((prev) => [
						...prev,
						{
							role: 'assistant',
							content: '✨ Blog generation complete! Review your content in the Live Draft panel.',
						},
					]);
					setIsStreaming(true);
				}
			} catch (e: any) {
				setError(e?.message || 'Agent failed to respond.');
			} finally {
				setIsThinking(false);
			}

			return; // Return after processing
		}

		// ✨ REMOVED: Early-return logic for irrelevant queries
		// This was preventing greetings and help requests from reaching the conversation handler
		// Now ALL messages go through conversationHandler.processMessage which has proper
		// intent classification for greetings, help requests, and off-topic queries

		// Handle modification requests when agent already exists
		if (
			agent &&
			intent.wantsModification &&
			!flowContext.modificationInProgress
		) {
			// Store the original modification request
			setFlowContext((prev) => ({
				...prev,
				modificationInProgress: true,
				pendingModificationRequest: input.trim(), // Store the original request
			}));
			setMessages((prev) => [
				...prev,
				userMsg,
				{
					role: 'assistant',
					content: "⚠️ I understand you want to modify the current information. This will affect the blog generation flow.\n\n**Please confirm:** Type **'yes'** to proceed with modifications, or **'no'** to continue with the current flow.",
				},
			]);
			setInput('');
			return;
		}

		// ✨ Handle modification confirmation response (yes/no)
		if (
			agent &&
			flowContext.modificationInProgress &&
			flowContext.pendingModificationRequest &&
			/^(yes|no)$/i.test(input.trim())
		) {
			const handled = await handleModificationConfirmation(
				input,
				agent,
				flowContext,
				apiKey,
				userMsg,
				setFlowContext,
				setMessages,
				setAgent,
				setOutlineApproved,
				setOutline,
				setDraft,
				setShowBlogContent,
				setInput,
				setIsThinking,
				setError,
				updateData,
				setUserTopic,
				setTargetLocation,
				setIsStreaming
			);

			if (handled) return;
		}

		// ✨ Handle modifications when in modification mode
		if (agent && flowContext.modificationInProgress) {
			// Check if user is done with modifications
			if (
				/^(continue|done|proceed|that's all|finish|complete)$/i.test(
					input.trim()
				)
			) {
				// Reset modification mode
				setFlowContext((prev) => ({
					...prev,
					modificationInProgress: false,
					pendingModificationRequest: null,
				}));

				setMessages((prev) => [
					...prev,
					userMsg,
					{
						role: 'assistant',
						content: '✅ **Modifications Complete!**\n\nRegenerating the outline with your updated information...',
					},
				]);

				setInput('');

				// Regenerate outline with modified agent state
				await handleOutlineRegeneration(
					agent,
					{
						setAgent,
						setOutline,
						setDraft,
						setUserTopic,
						setTargetLocation,
						setTraceItems,
						setOutlineApproved,
						setShowBlogContent,
						setViewMode,
						setShowOutline,
					},
					updateData,
					setMessages,
					setIsThinking,
					setIsStreaming,
					setError
				);

				return;
			}

			// ✨ User wants to make another modification while in modification mode
			await handleAdditionalModification(
				input,
				agent,
				flowContext,
				apiKey,
				userMsg,
				setAgent,
				setOutlineApproved,
				setOutline,
				setDraft,
				setShowBlogContent,
				setInput,
				setIsThinking,
				setError,
				updateData,
				setUserTopic,
				setTargetLocation,
				setMessages,
				setFlowContext
			);

			return;

			// Otherwise, process the modification request through conversation handler
			// Fall through to normal message processing
		}

		// Handle automation during guided flow
		if (intent.wantsAutomation && agent) {
			const updatedAgent = switchToAutomationMode(
				agent,
				setFlowContext,
				setAgent,
				setMessages,
				userMsg
			);

			setInput('');

			try {
				await runAutomationFlow(
					updatedAgent,
					{
						setAgent,
						setOutline,
						setDraft,
						setUserTopic,
						setTargetLocation,
						setTraceItems,
						setShowBlogContent,
						setViewMode,
						setOutlineApproved,
					},
					updateData,
					setMessages,
					setIsThinking,
					setIsStreaming,
					setError,
					onCollapseSidebar
				);
			} catch (e: any) {
				setError(e?.message || 'Agent failed to respond.');
			}

			return; // Return after processing automation
		}

		setMessages((prev) => [...prev, userMsg]);
		setInput('');

		// Use blog generation handler
		try {
			await handleBlogGeneration(
				data,
				userTopic,
				targetLocation,
				draft,
				messages,
				userMsg,
				apiKey,
				flowContext,
				agent,
				{
					setAgent,
					setOutline,
					setDraft,
					setUserTopic,
					setTargetLocation,
					setTraceItems,
					setShowBlogContent,
					setViewMode,
					setOutlineApproved,
				},
				updateData,
				setMessages,
				setIsThinking,
				setIsStreaming,
				setError,
				onCollapseSidebar
			);
		} catch (e: any) {
			setError(e?.message || 'Agent failed to respond.');
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
	]);

	return (
		<div className='h-full flex flex-col overflow-hidden'>
			{/* Inject markdown styles */}
			<style>{markdownStyles}</style>

			<div className='flex-1 flex flex-col overflow-hidden'>
				{/* ✨ Full Automation Progress Indicator */}
				{agent?.preferences?.automationLevel === 'full' &&
					isThinking && (
						<div className='mb-4 p-4 bg-blue-50 border border-blue-300 rounded-lg'>
							<div className='flex items-center gap-3 mb-2'>
								<Spinner className='w-5 h-5' />
								<span className='font-semibold text-blue-800'>
									Agent is working in full
									automation mode...
								</span>
							</div>
							<div className='text-sm text-blue-700'>
								Current step:{' '}
								{agent.trace.length > 0
									? agent.trace[
											agent.trace
												.length -
												1
									  ]?.step
									: 'Initializing'}
							</div>
							<div className='mt-2 text-xs text-blue-600'>
								{agent.trace.length} steps
								completed
							</div>
						</div>
					)}

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
