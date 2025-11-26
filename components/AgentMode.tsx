import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import * as agentService from '../services/agentService';
import {
	runNext as lgRunNext,
	AgentState,
} from '../services/langgraph/agentGraph';
import * as geminiService from '../services/geminiService';
import * as conversationHandler from '../services/conversationHandler';
import * as automationEngine from '../services/automationEngine';
import Spinner from './common/Spinner';
import StreamingText from './StreamingText';
import {
	BlogData,
	Interlink,
	OutlineSection,
	AutomationLevel,
	ChatMessage,
	ReferenceFile,
} from '../types';

// Extracted components
import SettingsPanel from './agentComponents/panels/SettingsPanel';
import BlogInfoPanel from './agentComponents/panels/BlogInfoPanel';
import TracePanel from './agentComponents/panels/TracePanel';
import DraggableOutline from './agentComponents/content/DraggableOutline';

// Selection components
import PrimaryKeywordSelection from './agentComponents/selections/PrimaryKeywordSelection';
import SecondaryKeywordSelection from './agentComponents/selections/SecondaryKeywordSelection';
import TitleSelection from './agentComponents/selections/TitleSelection';
import InterlinkingForm from './agentComponents/selections/InterlinkingForm';
import ReferencesForm from './agentComponents/selections/ReferencesForm';
import OutlineApproval from './agentComponents/selections/OutlineApproval';

// Extracted utilities
import {
	fileToBase64,
	getStepMessage,
} from './agentComponents/utils/agentHelpers';

// Styles
import {
	markdownStyles,
	inputTextareaStyles,
} from './agentComponents/styles/agentModeStyles';

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
	// Intelligent flow management
	const [flowContext, setFlowContext] = useState<{
		automationLevel: AutomationLevel;
		hasProvidedInfo: boolean;
		missingFields: string[];
		awaitingConfirmation: boolean;
		currentStep: string;
		modificationInProgress: boolean;
		userRequestedAutomation: boolean;
		pendingModificationRequest: string | null; // Store the original modification request
	}>({
		automationLevel: 'guided', // Default to guided
		hasProvidedInfo: false,
		missingFields: [],
		awaitingConfirmation: false,
		currentStep: 'initial',
		modificationInProgress: false,
		userRequestedAutomation: false,
		pendingModificationRequest: null,
	});
	const [messages, setMessages] = useState<ChatMessage[]>([
		{
			role: 'assistant',
			content: `Hello! I'm your Blog Agent 🤖. `,
		},
	]);
	const [input, setInput] = useState('');
	const [draft, setDraft] = useState<string>(data.blogContent || '');
	const [userTopic, setUserTopic] = useState<string>(data.topic || '');
	const [targetLocation, setTargetLocation] = useState<string>(
		data.targetLocation || 'United States'
	);
	const [outline, setOutline] = useState<OutlineSection[]>(
		data.outline || []
	);
	const [outlineApproved, setOutlineApproved] = useState<boolean>(false);
	const [showBlogContent, setShowBlogContent] = useState<boolean>(
		!!(data.blogContent && data.blogContent.trim().length > 0)
	);
	const [isThinking, setIsThinking] = useState(false);
	const [isStreaming, setIsStreaming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [traceItems, setTraceItems] = useState<
		{ step: string; at: number }[]
	>([]);

	// SEO Ranker
	const [seoScore, setSeoScore] = useState<number | null>(null);
	const [seoPrimary, setSeoPrimary] = useState<string>('');
	const [seoCritical, setSeoCritical] = useState<string>('');
	const [isRanking, setIsRanking] = useState(false);

	// LangGraph agent orchestration state
	const [agent, setAgent] = useState<AgentState | null>(null);
	const [selectedSecondaries, setSelectedSecondaries] = useState<string[]>(
		[]
	);
	const [viewMode, setViewMode] = useState<'outline' | 'blog' | 'markdown'>(
		'outline'
	);
	const [showOutline, setShowOutline] = useState(true);

	// Interlinking form state
	const [interlinkKeyword, setInterlinkKeyword] = useState('');
	const [interlinkUrl, setInterlinkUrl] = useState('');
	const [currentReferenceUrl, setCurrentReferenceUrl] = useState('');

	// Track completed selections to disable them
	const [completedSelections, setCompletedSelections] = useState<
		Set<string>
	>(new Set());

	const scrollRef = useRef<HTMLDivElement>(null);

	// ✨ Allow sending during outline approval (for feedback), but disable after approval
	const canSend = useMemo(() => {
		if (!input.trim() || !apiKey) return false;

		// If outline is approved and blog generation has started, disable chat
		if (outlineApproved) return false;

		// Don't allow sending while thinking or streaming
		if (isThinking || isStreaming) return false;

		// Otherwise, allow chat (including during outline approval for feedback)
		return true;
	}, [input, apiKey, outlineApproved, isThinking, isStreaming]);

	const isInputLocked = outlineApproved || isThinking || isStreaming;

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
			console.log(
				'Setting showBlogContent to true - draft content detected'
			);
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
		const userMsg: ChatMessage = {
			role: 'user',
			content: input.trim(),
		};

		// Helper functions moved to agentComponents/utils/agentHelpers.ts

		// ✨ Intelligent flow detection based on user input
		const analyzeUserIntent = (content: string) => {
			// Check for automation requests
			const wantsFullAutomation =
				/generate.*automatically|auto.*generate|create.*automatic|full.*automation|generate blog automatically/i.test(
					content
				);
			const wantsAutomation =
				/automat|auto.*select|auto.*choose|proceed.*automatic/i.test(
					content
				);

			// Check for general blog generation requests (without "automatically")
			const wantsBlogGeneration =
				/^(generate|create|write|make|build|produce)\s+(a\s+|an\s+|the\s+)?(blog|article|post|content)/i.test(
					content
				) && !wantsFullAutomation;

			// Check for information provided
			const hasDetailedInfo =
				/keyword|title|location|country|reference|link|url|target|primary|secondary|topic/i.test(
					content
				);

			// Check for modification requests
			const wantsModification =
				/change|modify|update|edit|different|instead|replace|go back/i.test(
					content
				);

			// Check for irrelevant queries
			const isIrrelevant =
				!hasDetailedInfo &&
				!wantsFullAutomation &&
				!wantsAutomation &&
				!wantsModification &&
				!wantsBlogGeneration &&
				!/blog|content|article|post|write|seo/i.test(content);

			return {
				wantsFullAutomation,
				wantsAutomation,
				wantsBlogGeneration,
				hasDetailedInfo,
				wantsModification,
				isIrrelevant,
			};
		};

		const intent = analyzeUserIntent(input.trim());

		// Helper function to extract topic from text
		const extractTopicFromText = (text: string): string | null => {
			// Try to extract topic from patterns like:
			// "generate blog about AI in healthcare"
			// "create article on remote work"
			// "write blog for web development"
			const patterns = [
				/(?:about|on|regarding|concerning|for)\s+(.+)/i,
				/(?:topic|subject):\s*(.+)/i,
				/(?:generate|create|write|make)\s+(?:blog|article|post|content)\s+(.+)/i,
			];

			for (const pattern of patterns) {
				const match = text.match(pattern);
				if (match && match[1]) {
					const extracted = match[1].trim();
					// Make sure it's not just keywords like "automatically"
					if (
						extracted.length > 5 &&
						!/^(automatically|auto|manually|guided)$/i.test(
							extracted
						)
					) {
						return extracted;
					}
				}
			}
			return null;
		};

		// Check if topic exists in previous messages
		const findTopicInHistory = (): string | null => {
			// Look through last 5 messages for a topic
			const recentMessages = messages.slice(-5);
			for (const msg of recentMessages) {
				if (msg.role === 'user') {
					const extracted = extractTopicFromText(
						msg.content
					);
					if (extracted) return extracted;

					// Check if it's a simple topic statement
					const content = msg.content.trim();
					if (
						content.length > 5 &&
						content.length < 150 &&
						!/^(generate|create|write|make|yes|no|ok|sure)/i.test(
							content
						) &&
						!intent.wantsModification
					) {
						return content;
					}
				}
			}
			return null;
		};

		// Handle general blog generation requests (generate blog, create blog, write blog, etc.)
		if (intent.wantsBlogGeneration && !agent) {
			// Try to extract topic from current message
			let topicFound = extractTopicFromText(input.trim());

			// If no topic in current message, check previous messages
			if (!topicFound) {
				topicFound = findTopicInHistory();
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
			const isValidTopic =
				providedText.length >= 3 &&
				!/^(yes|no|ok|okay|sure|generate|create|make|write|start)$/i.test(
					providedText
				) &&
				!intent.wantsModification;

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
			console.log(
				'═══════════════════════════════════════════════════'
			);
			console.log(
				'🔄 [MODIFICATION FLOW - INITIATED] User wants to modify existing information'
			);
			console.log(`   User request: "${input.trim()}"`);
			console.log(`   Current state:`, {
				hasTopic: !!agent.data.topic,
				hasPrimaryKeyword: !!agent.data.primaryKeyword,
				hasTitle: !!agent.data.title,
				hasOutline: agent.outline?.length > 0,
				outlineApproved: agent.outlineApproved,
			});
			console.log('   Action: Asking for user confirmation');
			console.log(
				'═══════════════════════════════════════════════════'
			);

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
			const confirmed = /^yes$/i.test(input.trim());

			if (confirmed) {
				// User confirmed - process the original modification request automatically
				console.log(
					'═══════════════════════════════════════════════════'
				);
				console.log(
					'🔄 [MODIFICATION FLOW - STEP 1] User confirmed modification'
				);
				console.log(
					`   Original request: "${flowContext.pendingModificationRequest}"`
				);
				console.log(`   Current agent state:`, {
					hasTopic: !!agent.data.topic,
					hasPrimaryKeyword: !!agent.data.primaryKeyword,
					hasTitle: !!agent.data.title,
					hasOutline: agent.outline?.length > 0,
					outlineApproved: agent.outlineApproved,
				});
				console.log(
					'═══════════════════════════════════════════════════'
				);

				// Capture modification request before clearing
				const modificationRequest =
					flowContext.pendingModificationRequest;

				// Reset agent state to allow modifications
				const modifiedAgent: AgentState = {
					...agent,
					outlineApproved: false,
					outline: [], // Clear outline - will be regenerated
					draft: '', // Clear draft to prevent auto-continuation
					finalBlogGenerated: false,
				};

				setAgent(modifiedAgent);
				setOutlineApproved(false);
				setOutline([]);
				setDraft('');
				setShowBlogContent(false);

				// Process the stored modification request through conversation handler
				setInput('');
				setIsThinking(true);

				try {
					console.log(
						'🔄 [MODIFICATION FLOW - STEP 2] Processing modification through conversation handler'
					);

					// Process the original modification request
					const modificationResponse =
						await conversationHandler.processMessage(
							modificationRequest,
							modifiedAgent,
							apiKey,
							flowContext.automationLevel
						);

					console.log(
						'🔄 [MODIFICATION FLOW - STEP 3] Modification processed, applying updates'
					);
					console.log(
						`   Response message: "${modificationResponse.assistantMessage}"`
					);
					console.log(
						`   State updates:`,
						modificationResponse.stateUpdates
					);

					// Apply state updates
					const updatedAgent = {
						...modifiedAgent,
						...modificationResponse.stateUpdates,
					};
					setAgent(updatedAgent);

					// Update the main data
					if (modificationResponse.stateUpdates?.data) {
						const updatedData =
							modificationResponse.stateUpdates
								.data;

						updateData({
							...updatedData,
						});

						// Update local state variables to reflect changes in UI
						if (updatedData.topic) {
							setUserTopic(updatedData.topic);
						}
						if (updatedData.targetLocation) {
							setTargetLocation(
								updatedData.targetLocation
							);
						}

						console.log(
							'🔄 [MODIFICATION FLOW - STEP 4] Updated blog data:',
							{
								topic: updatedData.topic,
								primaryKeyword:
									updatedData.primaryKeyword,
								title: updatedData.title,
								secondaryKeywords:
									updatedData
										.secondaryKeywords
										?.length || 0,
								targetLocation:
									updatedData.targetLocation,
							}
						);
					}

					// Show the modification was applied
					setMessages((prev) => [
						...prev,
						userMsg,
						{
							role: 'assistant',
							content: modificationResponse.assistantMessage,
						},
						{
							role: 'assistant',
							content: '✅ **Modification Applied!**\n\nWould you like to make any other changes to:\n- Primary keyword\n- Secondary keywords\n- Title\n- Target location\n- Internal/External links\n- Reference materials\n\nJust tell me what to change, or say **"continue"** or **"done"** to regenerate the outline.',
						},
					]);

					console.log(
						'🔄 [MODIFICATION FLOW - STEP 5] Staying in modification mode, waiting for user response'
					);
					console.log(
						'═══════════════════════════════════════════════════'
					);

					setFlowContext((prev) => ({
						...prev,
						modificationInProgress: true, // Keep in modification mode
						pendingModificationRequest: null, // Clear the pending request
					}));
				} catch (e: any) {
					console.error(
						'❌ [MODIFICATION FLOW - ERROR] Failed to process modification:',
						e
					);
					setError(
						e?.message ||
							'Failed to process modification.'
					);
					setFlowContext((prev) => ({
						...prev,
						modificationInProgress: false,
						pendingModificationRequest: null,
					}));
				} finally {
					setIsThinking(false);
				}
			} else {
				// User declined - cancel modification mode
				console.log(
					'═══════════════════════════════════════════════════'
				);
				console.log(
					'🔄 [MODIFICATION FLOW] User declined modification'
				);
				console.log(
					'   Action: Continuing with current blog setup'
				);
				console.log(
					'═══════════════════════════════════════════════════'
				);

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
						content: '👍 Got it! Continuing with the current blog setup.\n\nIf you need to make changes later, just let me know!',
					},
				]);
			}

			return;
		}

		// ✨ Handle modifications when in modification mode
		if (agent && flowContext.modificationInProgress) {
			// Check if user is done with modifications
			if (
				/^(continue|done|proceed|that's all|finish|complete)$/i.test(
					input.trim()
				)
			) {
				console.log(
					'═══════════════════════════════════════════════════'
				);
				console.log(
					'🔄 [MODIFICATION FLOW - STEP 6] User finished modifications'
				);
				console.log(
					'   Action: Regenerating outline with updated information'
				);
				console.log(`   Current blog data:`, {
					topic: agent.data.topic,
					primaryKeyword: agent.data.primaryKeyword,
					title: agent.data.title,
					secondaryKeywords:
						agent.data.secondaryKeywords?.length || 0,
					targetLocation: agent.data.targetLocation,
				});
				console.log(
					'═══════════════════════════════════════════════════'
				);

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
				setIsThinking(true);

				// Regenerate outline with modified agent state
				try {
					// Prepare agent for outline regeneration
					const regeneratingAgent: AgentState = {
						...agent,
						outline: [], // Clear outline
						outlineApproved: false,
						draft: '',
						finalBlogGenerated: false,
					};

					console.log(
						'🔄 [MODIFICATION FLOW - STEP 7] Starting outline regeneration'
					);

					let working = regeneratingAgent;
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

						console.log(
							`🔄 [MODIFICATION FLOW - STEP 7.${guard}] Agent step: ${step}, halted: ${halted}`
						);

						// Show progress messages
						if (
							working.trace.length > lastTraceLength
						) {
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
							lastTraceLength =
								working.trace.length;
						}

						// Update live state
						setAgent(working);
						setDraft(working.draft);
						setOutline(working.outline);

						// If outline generation is complete (halted at awaiting_approval), stop
						if (
							halted &&
							working.halt?.reason ===
								'awaiting_approval' &&
							working.outline?.length > 0
						) {
							console.log(
								'🔄 [MODIFICATION FLOW - STEP 8] Outline regenerated successfully'
							);
							console.log(
								`   New outline sections: ${working.outline.length}`
							);
							console.log(
								'   Waiting for user approval'
							);
							break;
						}

						// Safety: Only halt if user input is actually needed
						if (
							halted &&
							automationEngine.needsUserInput(ns)
						) {
							console.log(
								'🔄 [MODIFICATION FLOW] Halted - user input needed'
							);
							break;
						}
					}

					setAgent(working);
					setOutline(working.outline);
					setDraft(working.draft);
					setUserTopic(working.data.topic || '');
					setTargetLocation(
						working.data.targetLocation ||
							'United States'
					);
					setTraceItems(
						working.trace.map((t) => ({
							step: t.step,
							at: t.at,
						}))
					);

					// Update all blog data with modifications
					updateData({
						outline: working.outline,
						blogContent: working.draft,
						primaryKeyword: working.data.primaryKeyword,
						secondaryKeywords:
							working.data.secondaryKeywords,
						topic: working.data.topic,
						title: working.data.title,
						interlinks: working.data.interlinks,
						referenceUrls: working.data.referenceUrls,
						targetLocation: working.data.targetLocation,
					});

					console.log(
						'🔄 [MODIFICATION FLOW - STEP 8.1] Updated all state with regenerated data:',
						{
							outlineSections:
								working.outline?.length || 0,
							topic: working.data.topic,
							primaryKeyword:
								working.data.primaryKeyword,
							title: working.data.title,
						}
					);

					// Show outline for approval
					if (
						working.outline?.length > 0 &&
						working.halt?.reason === 'awaiting_approval'
					) {
						// Ensure outline UI is visible
						setShowOutline(true);
						setViewMode('outline');
						setOutlineApproved(false);
						setShowBlogContent(false);

						console.log(
							'🔄 [MODIFICATION FLOW - STEP 8.2] Setting UI state to show outline'
						);
						console.log('   showOutline: true');
						console.log('   viewMode: outline');
						console.log('   outlineApproved: false');
						console.log(
							'   Displaying outline approval component in chat'
						);

						setMessages((prev) => [
							...prev,
							{
								role: 'assistant',
								content: '✅ **Outline Regenerated!**\n\nPlease review the updated outline below and approve to continue, or provide feedback to regenerate:',
								outlineApproval: {
									outline:
										working.outline ||
										[],
								},
							},
						]);
						console.log(
							'🔄 [MODIFICATION FLOW - COMPLETE] Outline regeneration complete, awaiting approval'
						);
						console.log(
							'   📊 Summary of changes applied:'
						);
						console.log(
							`      - Topic: ${working.data.topic}`
						);
						console.log(
							`      - Primary Keyword: ${working.data.primaryKeyword}`
						);
						console.log(
							`      - Title: ${working.data.title}`
						);
						console.log(
							`      - Secondary Keywords: ${
								working.data.secondaryKeywords
									?.length || 0
							}`
						);
						console.log(
							`      - Target Location: ${working.data.targetLocation}`
						);
						console.log(
							`      - Outline Sections: ${working.outline.length}`
						);
						console.log(
							'═══════════════════════════════════════════════════'
						);
					}
				} catch (e: any) {
					console.error(
						'❌ [MODIFICATION FLOW - ERROR] Outline regeneration failed:',
						e
					);
					setError(
						e?.message ||
							'Failed to regenerate outline.'
					);
				} finally {
					setIsThinking(false);
				}

				return;
			}

			// ✨ User wants to make another modification while in modification mode
			// Process it directly without asking for confirmation again
			console.log(
				'═══════════════════════════════════════════════════'
			);
			console.log(
				'🔄 [MODIFICATION FLOW - ADDITIONAL CHANGE] Processing another modification'
			);
			console.log(`   Request: "${input.trim()}"`);
			console.log(
				'   Note: No confirmation needed - already in modification mode'
			);
			console.log(
				'═══════════════════════════════════════════════════'
			);

			// Capture the modification request before clearing input
			const modificationRequest = input.trim();

			// Reset agent state to allow modifications
			const modifiedAgent: AgentState = {
				...agent,
				outlineApproved: false,
				outline: [], // Clear outline
				draft: '',
				finalBlogGenerated: false,
			};

			setAgent(modifiedAgent);
			setOutlineApproved(false);
			setOutline([]);
			setDraft('');
			setShowBlogContent(false);

			setInput('');
			setIsThinking(true);

			try {
				// Process the modification request
				const modificationResponse =
					await conversationHandler.processMessage(
						modificationRequest,
						modifiedAgent,
						apiKey,
						flowContext.automationLevel
					);

				console.log(
					'🔄 [MODIFICATION FLOW - ADDITIONAL CHANGE] Modification processed'
				);
				console.log(
					`   Response: "${modificationResponse.assistantMessage}"`
				);

				// Apply state updates
				const updatedAgent = {
					...modifiedAgent,
					...modificationResponse.stateUpdates,
				};
				setAgent(updatedAgent);

				// Update the main data
				if (modificationResponse.stateUpdates?.data) {
					const updatedData =
						modificationResponse.stateUpdates.data;

					updateData({
						...updatedData,
					});

					// Update local state variables to reflect changes in UI
					if (updatedData.topic) {
						setUserTopic(updatedData.topic);
					}
					if (updatedData.targetLocation) {
						setTargetLocation(
							updatedData.targetLocation
						);
					}

					console.log(
						'🔄 [MODIFICATION FLOW - ADDITIONAL CHANGE] Updated UI state:',
						{
							topic: updatedData.topic,
							primaryKeyword:
								updatedData.primaryKeyword,
							title: updatedData.title,
							secondaryKeywords:
								updatedData.secondaryKeywords
									?.length || 0,
							targetLocation:
								updatedData.targetLocation,
						}
					);
				}

				// Show the modification was applied
				setMessages((prev) => [
					...prev,
					userMsg,
					{
						role: 'assistant',
						content: modificationResponse.assistantMessage,
					},
					{
						role: 'assistant',
						content: '✅ **Modification Applied!**\n\nWould you like to make any other changes?\n\n- To modify more, just tell me what to change\n- Or say **"continue"** or **"done"** to regenerate the outline',
					},
				]);

				console.log(
					'🔄 [MODIFICATION FLOW - ADDITIONAL CHANGE] Staying in modification mode'
				);
				console.log(
					'═══════════════════════════════════════════════════'
				);

				// Keep in modification mode
				setFlowContext((prev) => ({
					...prev,
					modificationInProgress: true,
					pendingModificationRequest: null,
				}));
			} catch (e: any) {
				console.error(
					'❌ [MODIFICATION FLOW - ERROR] Additional modification failed:',
					e
				);
				setError(
					e?.message || 'Failed to process modification.'
				);
			} finally {
				setIsThinking(false);
			}

			return;

			// Otherwise, process the modification request through conversation handler
			// Fall through to normal message processing
		}

		// Handle automation during guided flow
		if (intent.wantsAutomation && agent) {
			setFlowContext((prev) => ({
				...prev,
				automationLevel: 'full',
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

			// Update the agent state with new preferences
			setAgent(updatedAgent);

			setMessages((prev) => [
				...prev,
				userMsg,
				{
					role: 'assistant',
					content: "🔄 **Switching to Automation Mode**\n\nI'll handle all remaining steps automatically without asking questions. Let me complete your blog!",
				},
			]);
			setInput('');
			setIsThinking(true);

			// Don't return - continue with agent execution below
			// Use the updated agent with full automation preferences
			try {
				let working = updatedAgent;

				// Run agent with full automation
				const maxIterations = 100; // More iterations for full automation
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

					// Only halt if user input is actually needed (shouldn't happen in full automation)
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

			return; // Return after processing automation
		}

		setMessages((prev) => [...prev, userMsg]);

		// Track if we're handling special setup cases to skip conversation handler's message
		const isAutomationTopicSetup =
			!agent &&
			flowContext.userRequestedAutomation &&
			flowContext.currentStep === 'automation' &&
			flowContext.hasProvidedInfo;

		const isGuidedTopicSetup =
			!agent &&
			!flowContext.userRequestedAutomation &&
			flowContext.currentStep === 'processing' &&
			flowContext.hasProvidedInfo;

		const isAutomationWithData =
			!agent &&
			flowContext.userRequestedAutomation &&
			flowContext.currentStep === 'automation_with_data';

		setInput('');
		setIsThinking(true);

		try {
			// Initialize agent state if this is the first actionable turn
			let working =
				agent ??
				({
					data: {
						...data,
						topic: userTopic || data.topic || '',
						targetLocation:
							targetLocation ||
							data.targetLocation ||
							'United States',
						primaryKeyword: data.primaryKeyword || '',
						secondaryKeywords:
							data.secondaryKeywords || [],
						title: data.title || '',
						interlinks: data.interlinks || [],
						referenceUrls: data.referenceUrls || [],
						referenceFiles: data.referenceFiles || [],
					},
					apiKey,
					outline: [...(data.outline || [])],
					outlineApproved: false,
					draft,
					messages: messages.concat(userMsg),
					progress: { sectionIndex: 0 },
					policy: {
						referencesUsage: 'both',
						grounding: true,
					},
					trace: [],
					halt: null,
					titleSelected: false,
					interlinkingCompleted: false,
					referencesCollected: false,
					finalBlogGenerated: false,
					preferences: {
						automationLevel:
							flowContext.automationLevel,
						skipOptionalSteps:
							flowContext.automationLevel ===
							'full',
						autoSelectBestOptions:
							flowContext.automationLevel ===
							'full',
					},
					userProvidedFields: new Set(),
					autoFillFields: new Set(),
				} as AgentState);

			// ✨ NEW: Process message with conversation handler
			const conversationResponse =
				await conversationHandler.processMessage(
					userMsg.content,
					working,
					apiKey,
					flowContext.automationLevel // Pass the determined automation mode
				);

			// Show assistant's interpretation/response
			if (isAutomationTopicSetup) {
				// For automation topic setup, show custom message
				const currentTopic = userTopic || userMsg.content;
				setMessages((prev) => [
					...prev,
					{
						role: 'assistant',
						content: `🚀 ** Perfect! Starting Full Automation...**\n\n ** Topic:** ${currentTopic} \n\nI'll now auto-generate all the content for you. Sit back and watch the magic happen!`,
					},
				]);
			} else if (isAutomationWithData) {
				// For automation with existing data, show data analysis
				const hasExistingData = {
					topic: !!(userTopic || data.topic),
					primaryKeyword: !!data.primaryKeyword,
					secondaryKeywords:
						(data.secondaryKeywords || []).length > 0,
					title: !!data.title,
					references: (data.referenceUrls || []).length > 0,
					interlinks: (data.interlinks || []).length > 0,
				};

				let dataStatus =
					'🎯 **Analyzing your existing data...**\n\n';
				if (hasExistingData.topic)
					dataStatus += `✅ Topic: ${
						userTopic || data.topic
					}\n`;
				if (hasExistingData.primaryKeyword)
					dataStatus += `✅ Primary Keyword: ${data.primaryKeyword}\n`;
				if (hasExistingData.secondaryKeywords)
					dataStatus += `✅ Secondary Keywords: ${data.secondaryKeywords.join(
						', '
					)}\n`;
				if (hasExistingData.title)
					dataStatus += `✅ Title: ${data.title}\n`;
				if (hasExistingData.references)
					dataStatus += `✅ References: ${data.referenceUrls.length} link(s)\n`;
				if (hasExistingData.interlinks)
					dataStatus += `✅ Internal Links: ${data.interlinks.length} link(s)\n`;

				dataStatus +=
					"\n**Switching to Full Automation Mode...**\n\nI'll use this information and auto-generate the remaining content!";

				setMessages((prev) => [
					...prev,
					{
						role: 'assistant',
						content: dataStatus,
					},
				]);
			} else if (isGuidedTopicSetup) {
				// For guided mode topic setup, show custom message
				const currentTopic = userTopic || userMsg.content;
				setMessages((prev) => [
					...prev,
					{
						role: 'assistant',
						content: `Great! I'll help you create a blog post about **"${currentTopic}"**.\n\nLet me start by researching keywords and generating an outline. I'll ask for your approval at key steps.`,
					},
				]);
			} else {
				// Regular flow - use conversation handler's message
				setMessages((prev) => [
					...prev,
					{
						role: 'assistant',
						content: conversationResponse.assistantMessage,
					},
				]);
			}
			setIsStreaming(true);

			// Apply state updates from conversation handler
			working = {
				...working,
				...conversationResponse.stateUpdates,
			};

			// Run agent if conversation handler says so
			if (conversationResponse.shouldRunAgent) {
				// Increase guard for full automation (more steps)
				const maxIterations =
					working.preferences?.automationLevel === 'full'
						? 100
						: 20;
				let guard = 0;
				let lastTraceLength = 0;

				while (guard++ < maxIterations) {
					const {
						state: ns,
						halted,
						step,
					} = await lgRunNext(working);
					working = ns;

					// ✨ Show progress messages for each new trace entry
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

							// Small delay for UX (let user see the message)
							await new Promise((resolve) =>
								setTimeout(resolve, 300)
							);
						}
						lastTraceLength = working.trace.length;
					}

					// Update live state for progress indicator
					setAgent(working);
					setDraft(working.draft);
					setOutline(working.outline);

					// ✨ If outline was auto-approved, switch to blog content view
					if (working.outlineApproved && !outlineApproved) {
						console.log(
							'Outline approved - showing blog content'
						);
						setOutlineApproved(true);
						setShowBlogContent(true);
						setViewMode('markdown');
						// Collapse sidebar when blog content appears
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
			}

			setAgent(working);
			setOutline(working.outline);
			setDraft(working.draft);
			setUserTopic(working.data.topic || '');
			setTargetLocation(
				working.data.targetLocation || 'United States'
			);
			setTraceItems(
				working.trace.map((t) => ({ step: t.step, at: t.at }))
			);
			updateData({
				outline: working.outline,
				blogContent: working.draft,
				primaryKeyword: working.data.primaryKeyword,
				secondaryKeywords: working.data.secondaryKeywords,
				topic: working.data.topic,
				targetLocation: working.data.targetLocation,
			});

			// ✨ Outline approval is shown for ALL modes (not conditional)
			if (working.halt?.reason === 'awaiting_approval') {
				setMessages((prev) => [
					...prev,
					{
						role: 'assistant',
						content: '📋 Outline is ready! Review it below and approve to continue, or provide feedback to regenerate:',
						outlineApproval: {
							outline: working.outline || [],
						},
					},
				]);
			}

			// ✨ Surface status messages based on halts (only in guided/manual mode)
			if (working.preferences?.automationLevel !== 'full') {
				if (
					working.halt?.reason === 'await_keyword_selection'
				) {
					setMessages((prev) => [
						...prev,
						{
							role: 'assistant',
							content: '🎯 Please select a primary keyword from the options below:\n\n💡 Tip: If you would like to provide your own primary keyword, simply type it in the chat!',
							keywordSelection: {
								type: 'primary',
								candidates:
									working.keywordResearch?.primaryCandidates?.slice(
										0,
										10
									) || [],
							},
						},
					]);
				} else if (
					working.halt?.reason ===
					'await_secondary_selection'
				) {
					setMessages((prev) => [
						...prev,
						{
							role: 'assistant',
							content: '🎯 Select up to 5 secondary keywords:\n\n💡 Tip: If you would like to provide your own secondary keywords, simply type them in the chat (comma-separated)!',
							keywordSelection: {
								type: 'secondary',
								candidates:
									working.keywordResearch?.secondaryCandidates?.slice(
										0,
										12
									) || [],
							},
						},
					]);
				} else if (
					working.halt?.reason === 'await_title_selection'
				) {
					if (
						working.titleOptions &&
						working.titleOptions.length > 0
					) {
						setMessages((prev) => [
							...prev,
							{
								role: 'assistant',
								content: '📝 Select a blog title from the options below:\n\n💡 Tip: If you would like to provide your own title, simply type it in the chat!',
								titleSelection: {
									titles: working.titleOptions,
								},
							},
						]);
					}
				} else if (
					working.halt?.reason === 'await_interlinking'
				) {
					setMessages((prev) => [
						...prev,
						{
							role: 'assistant',
							content: '🔗 Add internal/external links (optional) or click "Continue" to skip:',
							interlinkingForm: {
								currentLinks:
									working.data.interlinks ||
									[],
							},
						},
					]);
				} else if (
					working.halt?.reason === 'await_references'
				) {
					setMessages((prev) => [
						...prev,
						{
							role: 'assistant',
							content: '📚 Add reference materials (URLs or files) to improve content quality, or click "Continue" to skip:',
							referencesForm: {
								currentUrls:
									working.data
										.referenceUrls ||
									[],
								currentFiles:
									working.data
										.referenceFiles ||
									[],
							},
						},
					]);
				} else if (
					working.halt?.reason === 'references_not_used'
				) {
					setMessages((prev) => [
						...prev,
						{
							role: 'assistant',
							content: '⚠️ References were not used in the last section. Provide alternative links or proceed without them.',
						},
					]);
					setIsStreaming(true);
				}
			}

			// ✨ Final completion message
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
				{/* ✨ Automation Mode Selector - DEPRECATED (now in chat) */}
				{false && (
					<div className='mb-5 p-4 bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 border border-blue-200/50 rounded-2xl shadow-lg'>
						<div className='flex items-center justify-between mb-3'>
							<div className='text-sm font-bold text-gray-800 flex items-center gap-2'>
								<span className='text-lg'>
									⚙️
								</span>
								Control Level:
							</div>
							<div className='text-xs px-3 py-1.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-full shadow-lg font-semibold'>
								Active:{' '}
								{flowContext.automationLevel ===
								'full'
									? '🚀 Full Automation'
									: flowContext.automationLevel ===
									  'guided'
									? '🎯 Guided'
									: '✋ Manual'}
							</div>
						</div>
						<div className='flex gap-3'>
							<label
								className={`flex items-center gap-2 ${
									agent
										? 'cursor-not-allowed opacity-60'
										: 'cursor-pointer'
								}`}
							>
								<input
									type='radio'
									name='automation-mode'
									value='full'
									checked={
										flowContext.automationLevel ===
										'full'
									}
									disabled={!!agent}
									onChange={(e) =>
										setFlowContext(
											(prev) => ({
												...prev,
												automationLevel:
													e
														.target
														.value as AutomationLevel,
											})
										)
									}
									className='w-4 h-4 text-blue-600'
								/>
								<span className='text-sm'>
									<strong>
										Full Automation
									</strong>{' '}
									- I decide everything
								</span>
							</label>
							<label
								className={`flex items-center gap-2 ${
									agent
										? 'cursor-not-allowed opacity-60'
										: 'cursor-pointer'
								}`}
							>
								<input
									type='radio'
									name='automation-mode'
									value='guided'
									checked={
										flowContext.automationLevel ===
										'guided'
									}
									disabled={!!agent}
									onChange={(e) =>
										setFlowContext(
											(prev) => ({
												...prev,
												automationLevel:
													e
														.target
														.value as AutomationLevel,
											})
										)
									}
									className='w-4 h-4 text-blue-600'
								/>
								<span className='text-sm'>
									<strong>Guided</strong> -
									I approve key decisions
								</span>
							</label>
							<label
								className={`flex items-center gap-2 ${
									agent
										? 'cursor-not-allowed opacity-60'
										: 'cursor-pointer'
								}`}
							>
								<input
									type='radio'
									name='automation-mode'
									value='manual'
									checked={
										flowContext.automationLevel ===
										'manual'
									}
									disabled={!!agent}
									onChange={(e) =>
										setFlowContext(
											(prev) => ({
												...prev,
												automationLevel:
													e
														.target
														.value as AutomationLevel,
											})
										)
									}
									className='w-4 h-4 text-blue-600'
								/>
								<span className='text-sm'>
									<strong>Manual</strong> -
									I control everything
								</span>
							</label>
						</div>
					</div>
				)}

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

				{/* Keyword selection now in chat */}

				{/* Outline Approval Panels */}
				{false &&
					agent?.preferences?.automationLevel !== 'full' &&
					agent?.halt?.reason ===
						'await_keyword_selection' &&
					agent?.keywordResearch?.primaryCandidates && (
						<div className='mb-4 p-3 border rounded bg-amber-50'>
							<div className='font-semibold mb-2'>
								Keyword candidates (Primary -
								DEPRECATED)
							</div>
							<div className='grid grid-cols-1 md:grid-cols-2 gap-2'>
								{agent.keywordResearch.primaryCandidates
									.slice(0, 10)
									.map((r, idx) => (
										<div
											key={idx}
											className='flex items-center justify-between text-sm bg-white border rounded p-2'
										>
											<div>
												<div className='font-medium'>
													{
														r.text
													}
												</div>
												<div className='text-xs text-gray-500'>
													Vol:{' '}
													{
														r.volume
													}{' '}
													·
													Diff:{' '}
													{r.difficulty.toFixed(
														2
													)}
												</div>
											</div>
											<button
												className='px-2 py-1 text-xs bg-orange-500 text-white rounded'
												onClick={async () => {
													if (
														!agent
													)
														return;

													// ✨ Show selection message
													setMessages(
														(
															prev
														) => [
															...prev,
															{
																role: 'assistant',
																content: `✅ Selected "${r.text}" as primary keyword. Continuing...`,
															},
														]
													);

													const next =
														{
															...agent,
															data: {
																...agent.data,
																primaryKeyword:
																	r.text,
															},
														} as AgentState;
													setAgent(
														next
													);
													updateData(
														{
															primaryKeyword:
																r.text,
														}
													);
													setIsThinking(
														true
													);
													try {
														let working =
															next;
														let guard = 0;
														let lastTraceLength = 0;

														while (
															guard++ <
															20
														) {
															const {
																state: ns,
																halted,
																step,
															} = await lgRunNext(
																working
															);
															working =
																ns;

															// Show progress messages
															if (
																working
																	.trace
																	.length >
																lastTraceLength
															) {
																const latestTrace =
																	working
																		.trace[
																		working
																			.trace
																			.length -
																			1
																	];
																const stepMessage =
																	getStepMessage(
																		latestTrace.step,
																		latestTrace.info
																	);

																if (
																	stepMessage
																) {
																	setMessages(
																		(
																			prev
																		) => [
																			...prev,
																			{
																				role: 'assistant',
																				content: stepMessage,
																			},
																		]
																	);
																	await new Promise(
																		(
																			resolve
																		) =>
																			setTimeout(
																				resolve,
																				300
																			)
																	);
																}
																lastTraceLength =
																	working
																		.trace
																		.length;
															}

															if (
																halted
															)
																break;
														}
														setAgent(
															working
														);
														setOutline(
															working.outline
														);
														setDraft(
															working.draft
														);
														setTraceItems(
															working.trace.map(
																(
																	t
																) => ({
																	step: t.step,
																	at: t.at,
																})
															)
														);
														updateData(
															{
																outline: working.outline,
																blogContent:
																	working.draft,
																secondaryKeywords:
																	working
																		.data
																		.secondaryKeywords,
															}
														);
														if (
															working
																.halt
																?.reason ===
															'await_secondary_selection'
														) {
															setMessages(
																(
																	prev
																) => [
																	...prev,
																	{
																		role: 'assistant',
																		content: '🎯 Select up to 5 secondary keywords below.',
																	},
																]
															);
														}
													} finally {
														setIsThinking(
															false
														);
													}
												}}
											>
												Select
											</button>
										</div>
									))}
							</div>
						</div>
					)}

				{false &&
					agent?.preferences?.automationLevel !== 'full' &&
					agent?.halt?.reason ===
						'await_secondary_selection' &&
					agent?.keywordResearch?.secondaryCandidates && (
						<div className='mb-4 p-3 border rounded bg-amber-50'>
							<div className='font-semibold mb-2'>
								Keyword candidates (Secondary -
								DEPRECATED) — select up to 5
							</div>
							<div className='grid grid-cols-1 md:grid-cols-2 gap-2'>
								{agent.keywordResearch.secondaryCandidates
									.slice(0, 12)
									.map((r, idx) => {
										const checked =
											selectedSecondaries.includes(
												r.text
											);
										return (
											<label
												key={
													idx
												}
												className='flex items-center justify-between text-sm bg-white border rounded p-2 cursor-pointer'
											>
												<div className='flex items-center gap-2'>
													<input
														type='checkbox'
														checked={
															checked
														}
														onChange={(
															e
														) => {
															setSelectedSecondaries(
																(
																	prev
																) => {
																	if (
																		e
																			.target
																			.checked
																	) {
																		const next =
																			[
																				...prev,
																				r.text,
																			];
																		return next.slice(
																			0,
																			5
																		);
																	}
																	return prev.filter(
																		(
																			x
																		) =>
																			x !==
																			r.text
																	);
																}
															);
														}}
													/>
													<div>
														<div className='font-medium'>
															{
																r.text
															}
														</div>
														<div className='text-xs text-gray-500'>
															Vol:{' '}
															{
																r.volume
															}{' '}
															·
															Diff:{' '}
															{r.difficulty.toFixed(
																2
															)}
														</div>
													</div>
												</div>
											</label>
										);
									})}
							</div>
							<div className='mt-2'>
								<button
									className='px-3 py-1 text-sm bg-orange-600 text-white rounded disabled:bg-orange-300'
									disabled={
										selectedSecondaries.length ===
										0
									}
									onClick={async () => {
										if (!agent) return;
										const next = {
											...agent,
											data: {
												...agent.data,
												secondaryKeywords:
													selectedSecondaries,
											},
										} as AgentState;
										setAgent(next);
										updateData({
											secondaryKeywords:
												selectedSecondaries,
										});
										setIsThinking(true);
										try {
											let working =
												next;
											let guard = 0;
											while (
												guard++ <
												20
											) {
												const {
													state: ns,
													halted,
												} =
													await lgRunNext(
														working
													);
												working =
													ns;
												if (
													halted
												)
													break;
											}
											setAgent(
												working
											);
											setOutline(
												working.outline
											);
											setDraft(
												working.draft
											);
											setTraceItems(
												working.trace.map(
													(
														t
													) => ({
														step: t.step,
														at: t.at,
													})
												)
											);
											updateData({
												outline: working.outline,
												blogContent:
													working.draft,
											});
											if (
												working
													.halt
													?.reason ===
												'awaiting_approval'
											) {
												setMessages(
													(
														prev
													) => [
														...prev,
														{
															role: 'assistant',
															content: '📋 Outline ready! Click "Approve outline" to proceed, or provide feedback to regenerate.',
														},
													]
												);
											}
										} finally {
											setIsThinking(
												false
											);
										}
									}}
								>
									Confirm selection
								</button>
							</div>
						</div>
					)}

				{/* Title Selection Panel - DEPRECATED (now in chat) */}
				{false &&
					agent?.preferences?.automationLevel !== 'full' &&
					agent?.halt?.reason === 'await_title_selection' &&
					agent?.titleOptions && (
						<div className='mb-4 p-3 border rounded bg-purple-50'>
							<div className='font-semibold mb-2'>
								Select a Blog Title (DEPRECATED)
							</div>
							<div className='space-y-2'>
								{agent.titleOptions.map(
									(title, idx) => (
										<div
											key={idx}
											className='flex items-center justify-between text-sm bg-white border rounded p-2'
										>
											<div className='flex-1'>
												{title}
											</div>
											<button
												className='px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600'
												onClick={async () => {
													if (
														!agent
													)
														return;
													const next =
														{
															...agent,
															data: {
																...agent.data,
																title,
															},
															titleSelected:
																true,
														} as AgentState;
													setAgent(
														next
													);
													updateData(
														{
															title,
														}
													);
													setIsThinking(
														true
													);
													try {
														let working =
															next;
														let guard = 0;
														while (
															guard++ <
															20
														) {
															const {
																state: ns,
																halted,
															} =
																await lgRunNext(
																	working
																);
															working =
																ns;
															if (
																halted
															)
																break;
														}
														setAgent(
															working
														);
														setOutline(
															working.outline
														);
														setDraft(
															working.draft
														);
														setTraceItems(
															working.trace.map(
																(
																	t
																) => ({
																	step: t.step,
																	at: t.at,
																})
															)
														);
														updateData(
															{
																outline: working.outline,
																blogContent:
																	working.draft,
															}
														);
													} finally {
														setIsThinking(
															false
														);
													}
												}}
											>
												Select
											</button>
										</div>
									)
								)}
							</div>
							<div className='mt-3'>
								<input
									type='text'
									placeholder='Or enter your own title...'
									className='w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500'
									onKeyDown={async (e) => {
										if (
											e.key ===
												'Enter' &&
											e.currentTarget.value.trim()
										) {
											const customTitle =
												e.currentTarget.value.trim();
											if (!agent)
												return;
											const next = {
												...agent,
												data: {
													...agent.data,
													title: customTitle,
												},
												titleSelected:
													true,
											} as AgentState;
											setAgent(
												next
											);
											updateData({
												title: customTitle,
											});
											setIsThinking(
												true
											);
											try {
												let working =
													next;
												let guard = 0;
												while (
													guard++ <
													20
												) {
													const {
														state: ns,
														halted,
													} =
														await lgRunNext(
															working
														);
													working =
														ns;
													if (
														halted
													)
														break;
												}
												setAgent(
													working
												);
												setOutline(
													working.outline
												);
												setDraft(
													working.draft
												);
												setTraceItems(
													working.trace.map(
														(
															t
														) => ({
															step: t.step,
															at: t.at,
														})
													)
												);
												updateData(
													{
														outline: working.outline,
														blogContent:
															working.draft,
													}
												);
											} finally {
												setIsThinking(
													false
												);
											}
										}
									}}
								/>
							</div>
						</div>
					)}

				{/* Interlinking Panel - DEPRECATED (now in chat) */}
				{false &&
					agent?.preferences?.automationLevel !== 'full' &&
					agent?.halt?.reason === 'await_interlinking' && (
						<div className='mb-4 p-3 border rounded bg-green-50'>
							<div className='font-semibold mb-2'>
								Add Internal/External Links
								(DEPRECATED) (Optional)
							</div>
							<div className='text-sm text-gray-700 mb-3'>
								Add links that should be
								contextually placed in the blog
								content.
							</div>
							<div className='space-y-2 mb-3'>
								{(data.interlinks || []).map(
									(link) => (
										<div
											key={link.id}
											className='flex items-center justify-between text-sm bg-white border rounded p-2'
										>
											<div>
												<div className='font-medium'>
													{
														link.keyword
													}
												</div>
												<div className='text-xs text-gray-500'>
													{
														link.url
													}
												</div>
											</div>
											<button
												className='px-2 py-1 text-xs bg-red-500 text-white rounded'
												onClick={() => {
													updateData(
														{
															interlinks:
																data.interlinks.filter(
																	(
																		l
																	) =>
																		l.id !==
																		link.id
																),
														}
													);
												}}
											>
												Remove
											</button>
										</div>
									)
								)}
							</div>
							<div className='flex gap-2 mb-3'>
								<input
									type='text'
									placeholder='Keyword/Anchor text'
									id='interlink-keyword'
									className='flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500'
								/>
								<input
									type='url'
									placeholder='URL'
									id='interlink-url'
									className='flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500'
								/>
								<button
									className='px-3 py-2 text-sm bg-green-600 text-white rounded'
									onClick={() => {
										const keywordInput =
											document.getElementById(
												'interlink-keyword'
											) as HTMLInputElement;
										const urlInput =
											document.getElementById(
												'interlink-url'
											) as HTMLInputElement;
										if (
											keywordInput?.value.trim() &&
											urlInput?.value.trim()
										) {
											updateData({
												interlinks:
													[
														...(data.interlinks ||
															[]),
														{
															id: Date.now().toString(),
															keyword: keywordInput.value.trim(),
															url: urlInput.value.trim(),
														},
													],
											});
											keywordInput.value =
												'';
											urlInput.value =
												'';
										}
									}}
								>
									Add
								</button>
							</div>
							<button
								className='px-3 py-1 text-sm bg-green-600 text-white rounded'
								onClick={async () => {
									if (!agent) return;
									const next = {
										...agent,
										interlinkingCompleted:
											true,
									} as AgentState;
									setAgent(next);
									setIsThinking(true);
									try {
										let working = next;
										let guard = 0;
										while (
											guard++ < 20
										) {
											const {
												state: ns,
												halted,
											} =
												await lgRunNext(
													working
												);
											working = ns;
											if (halted)
												break;
										}
										setAgent(working);
										setOutline(
											working.outline
										);
										setDraft(
											working.draft
										);
										setTraceItems(
											working.trace.map(
												(
													t
												) => ({
													step: t.step,
													at: t.at,
												})
											)
										);
										updateData({
											outline: working.outline,
											blogContent:
												working.draft,
										});
									} finally {
										setIsThinking(
											false
										);
									}
								}}
							>
								Continue (Skip if done)
							</button>
						</div>
					)}

				{/* References Collection Panel - DEPRECATED (now in chat) */}
				{false &&
					agent?.preferences?.automationLevel !== 'full' &&
					agent?.halt?.reason === 'await_references' && (
						<div className='mb-4 p-4 border-2 rounded-lg bg-gradient-to-br from-yellow-50 to-orange-50 border-yellow-300'>
							<div className='font-bold text-lg mb-3 text-gray-800 flex items-center gap-2'>
								<span className='text-2xl'>
									📚
								</span>
								Add Reference Materials
								(Optional)
							</div>
							<div className='text-sm text-gray-700 mb-4 bg-white/70 p-3 rounded-md'>
								<strong>💡 Tip:</strong> Provide
								reference URLs or upload
								PDF/DOCX files. The agent will
								use this content to generate
								more accurate and
								well-researched blog content.
							</div>

							<div className='grid grid-cols-1 md:grid-cols-2 gap-4 mb-4'>
								{/* URLs Section */}
								<div className='bg-white p-3 rounded-md border border-yellow-200'>
									<div className='font-semibold mb-2 text-gray-800 flex items-center gap-2'>
										🔗 Reference URLs
									</div>
									<div className='space-y-2 mb-3 max-h-40 overflow-y-auto'>
										{(
											data.referenceUrls ||
											[]
										).length === 0 ? (
											<div className='text-xs text-gray-500 italic py-2'>
												No URLs
												added
												yet
											</div>
										) : (
											(
												data.referenceUrls ||
												[]
											).map(
												(
													url,
													idx
												) => (
													<div
														key={
															idx
														}
														className='flex items-center justify-between text-sm bg-gray-50 border rounded p-2'
													>
														<div className='text-xs truncate flex-1'>
															{
																url
															}
														</div>
														<button
															className='px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600'
															onClick={() => {
																updateData(
																	{
																		referenceUrls:
																			data.referenceUrls.filter(
																				(
																					_,
																					i
																				) =>
																					i !==
																					idx
																			),
																	}
																);
															}}
														>
															✕
														</button>
													</div>
												)
											)
										)}
									</div>
									<div className='flex gap-2'>
										<input
											type='url'
											placeholder='https://example.com/article'
											id='reference-url-agent'
											className='flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:ring-yellow-500 focus:border-yellow-500'
											onKeyDown={(
												e
											) => {
												if (
													e.key ===
														'Enter' &&
													e.currentTarget.value.trim()
												) {
													const url =
														e.currentTarget.value.trim();
													if (
														!data.referenceUrls.includes(
															url
														)
													) {
														updateData(
															{
																referenceUrls:
																	[
																		...(data.referenceUrls ||
																			[]),
																		url,
																	],
															}
														);
													}
													e.currentTarget.value =
														'';
												}
											}}
										/>
										<button
											className='px-3 py-2 text-sm bg-yellow-600 text-white rounded hover:bg-yellow-700'
											onClick={() => {
												const urlInput =
													document.getElementById(
														'reference-url-agent'
													) as HTMLInputElement;
												if (
													urlInput?.value.trim()
												) {
													const url =
														urlInput.value.trim();
													if (
														!data.referenceUrls.includes(
															url
														)
													) {
														updateData(
															{
																referenceUrls:
																	[
																		...(data.referenceUrls ||
																			[]),
																		url,
																	],
															}
														);
													}
													urlInput.value =
														'';
												}
											}}
										>
											Add
										</button>
									</div>
								</div>

								{/* Files Section */}
								<div className='bg-white p-3 rounded-md border border-yellow-200'>
									<div className='font-semibold mb-2 text-gray-800 flex items-center gap-2'>
										📄 Reference Files
										(PDF/DOCX)
									</div>
									<div className='space-y-2 mb-3 max-h-40 overflow-y-auto'>
										{(
											data.referenceFiles ||
											[]
										).length === 0 ? (
											<div className='text-xs text-gray-500 italic py-2'>
												No files
												uploaded
												yet
											</div>
										) : (
											(
												data.referenceFiles ||
												[]
											).map(
												(
													file,
													idx
												) => (
													<div
														key={
															idx
														}
														className='flex items-center justify-between text-sm bg-gray-50 border rounded p-2'
													>
														<div className='flex items-center gap-2 flex-1 min-w-0'>
															<span className='text-lg'>
																{file.name.endsWith(
																	'.pdf'
																)
																	? '📕'
																	: '📘'}
															</span>
															<div className='truncate text-xs'>
																{
																	file.name
																}
															</div>
														</div>
														<button
															className='px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 flex-shrink-0'
															onClick={() => {
																updateData(
																	{
																		referenceFiles:
																			data.referenceFiles.filter(
																				(
																					_,
																					i
																				) =>
																					i !==
																					idx
																			),
																	}
																);
															}}
														>
															✕
														</button>
													</div>
												)
											)
										)}
									</div>
									<input
										type='file'
										id='reference-file-agent'
										accept='.pdf,.doc,.docx'
										className='hidden'
										onChange={async (
											e
										) => {
											if (
												e.target
													.files &&
												e.target
													.files
													.length >
													0
											) {
												const file =
													e
														.target
														.files[0];
												try {
													const base64 =
														await fileToBase64(
															file
														);
													const newFile: ReferenceFile =
														{
															name: file.name,
															mimeType: file.type,
															base64: base64,
														};
													updateData(
														{
															referenceFiles:
																[
																	...(data.referenceFiles ||
																		[]),
																	newFile,
																],
														}
													);
													// Clear the input
													e.target.value =
														'';
												} catch (error) {
													console.error(
														'Error uploading file:',
														error
													);
													alert(
														'Failed to upload file. Please try again.'
													);
												}
											}
										}}
									/>
									<button
										className='w-full px-3 py-2 text-sm bg-yellow-600 text-white rounded hover:bg-yellow-700 flex items-center justify-center gap-2'
										onClick={() => {
											document
												.getElementById(
													'reference-file-agent'
												)
												?.click();
										}}
									>
										<span>📤</span>
										Upload File
									</button>
								</div>
							</div>

							{/* Summary and Continue Button */}
							<div className='bg-white/70 p-3 rounded-md border border-yellow-200'>
								<div className='text-sm text-gray-700 mb-2'>
									<strong>Added:</strong>{' '}
									{data.referenceUrls
										?.length || 0}{' '}
									URL(s),{' '}
									{data.referenceFiles
										?.length || 0}{' '}
									File(s)
								</div>
								<button
									className='w-full px-4 py-2 text-sm font-semibold bg-gradient-to-r from-yellow-600 to-orange-600 text-white rounded-lg hover:from-yellow-700 hover:to-orange-700 shadow-md hover:shadow-lg transition-all'
									onClick={async () => {
										if (!agent) return;

										// Log what references are being used
										console.log(
											'📚 [REFERENCES] User completed reference collection'
										);
										console.log(
											`   URLs: ${
												data
													.referenceUrls
													?.length ||
												0
											}`
										);
										console.log(
											`   Files: ${
												data
													.referenceFiles
													?.length ||
												0
											}`
										);

										const next = {
											...agent,
											referencesCollected:
												true,
										} as AgentState;
										setAgent(next);
										setIsThinking(true);
										try {
											let working =
												next;
											let guard = 0;
											while (
												guard++ <
												20
											) {
												const {
													state: ns,
													halted,
												} =
													await lgRunNext(
														working
													);
												working =
													ns;
												if (
													halted
												)
													break;
											}
											setAgent(
												working
											);
											setOutline(
												working.outline
											);
											setDraft(
												working.draft
											);
											setTraceItems(
												working.trace.map(
													(
														t
													) => ({
														step: t.step,
														at: t.at,
													})
												)
											);
											updateData({
												outline: working.outline,
												blogContent:
													working.draft,
											});
										} finally {
											setIsThinking(
												false
											);
										}
									}}
								>
									{(data.referenceUrls
										?.length || 0) +
										(data.referenceFiles
											?.length ||
											0) >
									0
										? '✅ Continue with References'
										: '⏭️ Skip & Continue'}
								</button>
							</div>
						</div>
					)}

				{/* Outline Approval Panel - DEPRECATED (now in chat) */}
				{false &&
					agent?.halt?.reason === 'awaiting_approval' && (
						<div className='mb-4 p-3 border rounded bg-blue-50'>
							<div className='font-semibold mb-2'>
								Outline generated
							</div>
							<div className='text-sm text-gray-700 mb-3'>
								Review the outline shown in the
								Live Draft. You can:
							</div>
							<ul className='text-sm text-gray-700 mb-3 ml-4 list-disc'>
								<li>
									Click "Approve outline" to
									start blog generation
								</li>
								<li>
									Or provide feedback via
									chat to regenerate the
									outline
								</li>
							</ul>
							<button
								className='px-3 py-1 text-sm bg-blue-600 text-white rounded'
								onClick={async () => {
									if (!agent) return;

									// ✨ Show approval message
									setMessages((prev) => [
										...prev,
										{
											role: 'assistant',
											content: '✅ Outline approved! Starting blog generation...',
										},
									]);

									// ✨ Switch to markdown preview mode
									setViewMode('markdown');

									const next = {
										...agent,
										outlineApproved:
											true,
									} as AgentState;
									setAgent(next);
									console.log(
										'User approved outline - showing blog content'
									);
									setOutlineApproved(true);
									setShowBlogContent(true);
									// Collapse sidebar when blog content appears
									if (onCollapseSidebar) {
										onCollapseSidebar();
									}
									setIsThinking(true);
									try {
										let working = next;
										let guard = 0;
										let lastTraceLength = 0;

										while (
											guard++ < 50
										) {
											const {
												state: ns,
												halted,
												step,
											} = await lgRunNext(
												working
											);
											working = ns;

											// Show progress messages
											if (
												working
													.trace
													.length >
												lastTraceLength
											) {
												const latestTrace =
													working
														.trace[
														working
															.trace
															.length -
															1
													];
												const stepMessage =
													getStepMessage(
														latestTrace.step,
														latestTrace.info
													);

												if (
													stepMessage
												) {
													setMessages(
														(
															prev
														) => [
															...prev,
															{
																role: 'assistant',
																content: stepMessage,
															},
														]
													);
													await new Promise(
														(
															resolve
														) =>
															setTimeout(
																resolve,
																300
															)
													);
												}
												lastTraceLength =
													working
														.trace
														.length;
											}

											// Update live state
											setAgent(
												working
											);
											setDraft(
												working.draft
											);
											setOutline(
												working.outline
											);

											if (
												halted &&
												working
													.halt
													?.reason !==
													undefined
											)
												break;
										}
										setAgent(working);
										setOutline(
											working.outline
										);
										setDraft(
											working.draft
										);
										setTraceItems(
											working.trace.map(
												(
													t
												) => ({
													step: t.step,
													at: t.at,
												})
											)
										);
										updateData({
											outline: working.outline,
											blogContent:
												working.draft,
										});
										if (
											(working
												.progress
												.sectionIndex ??
												0) >=
											(working
												.outline
												?.length ||
												0)
										) {
											setMessages(
												(
													prev
												) => [
													...prev,
													{
														role: 'assistant',
														content: '✨ Blog generation complete! Review your content.',
													},
												]
											);
										}
									} finally {
										setIsThinking(
											false
										);
									}
								}}
							>
								Approve outline
							</button>
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
					<div
						className={`flex flex-col min-h-0 transition-all duration-700 ease-in-out ${
							showBlogContent ? 'w-[30%]' : 'w-full'
						} ${
							showBlogContent
								? 'border-2 border-orange-300 rounded-xl bg-white shadow-lg'
								: ''
						}`}
					>
						<div className='flex-1 overflow-y-auto py-3 px-4'>
							{messages.map((m, i) => (
								<div
									key={i}
									className={`mb-4 ${
										m.role === 'user'
											? 'flex justify-end'
											: 'flex justify-start'
									}`}
								>
									<div
										className={`px-4 py-2.5 rounded-xl text-sm whitespace-pre-wrap ${
											m.role ===
											'user'
												? 'bg-orange-500 text-white max-w-[75%]'
												: m.keywordSelection
												? 'bg-gray-100 border border-gray-200 max-w-full w-full'
												: m.titleSelection
												? 'bg-gray-100 border border-gray-200 max-w-full w-full'
												: m.interlinkingForm
												? 'bg-gray-100 border border-gray-200 max-w-full w-full'
												: m.referencesForm
												? 'bg-gray-100 border border-gray-200 max-w-full w-full'
												: m.outlineApproval
												? 'bg-gray-100 border border-gray-200 max-w-full w-full'
												: m.controlLevelSelection
												? 'bg-gray-100 border border-gray-200 max-w-md'
												: 'bg-gray-100 text-gray-800 max-w-[75%]'
										}`}
									>
										{m.role ===
											'assistant' &&
										!m.keywordSelection &&
										!m.titleSelection &&
										!m.interlinkingForm &&
										!m.referencesForm &&
										!m.outlineApproval &&
										!m.controlLevelSelection ? (
											<StreamingText
												text={
													m.content
												}
												speed={
													15
												}
												onComplete={() => {
													setIsStreaming(
														false
													);
												}}
											/>
										) : (
											m.content
										)}

										{/* Primary Keyword Selection */}
										{m.keywordSelection
											?.type ===
											'primary' && (
											<PrimaryKeywordSelection
												candidates={
													m
														.keywordSelection
														.candidates
												}
												agent={
													agent
												}
												completedSelections={
													completedSelections
												}
												setCompletedSelections={
													setCompletedSelections
												}
												setMessages={
													setMessages
												}
												setAgent={
													setAgent
												}
												updateData={
													updateData
												}
												setIsThinking={
													setIsThinking
												}
												setOutline={
													setOutline
												}
												setDraft={
													setDraft
												}
												setTraceItems={
													setTraceItems
												}
											/>
										)}

										{/* Secondary Keyword Selection */}
										{m.keywordSelection
											?.type ===
											'secondary' && (
											<SecondaryKeywordSelection
												candidates={
													m
														.keywordSelection
														.candidates
												}
												agent={
													agent
												}
												selectedSecondaries={
													selectedSecondaries
												}
												setSelectedSecondaries={
													setSelectedSecondaries
												}
												completedSelections={
													completedSelections
												}
												setCompletedSelections={
													setCompletedSelections
												}
												setMessages={
													setMessages
												}
												setAgent={
													setAgent
												}
												updateData={
													updateData
												}
												setIsThinking={
													setIsThinking
												}
												setOutline={
													setOutline
												}
												setDraft={
													setDraft
												}
												setTraceItems={
													setTraceItems
												}
											/>
										)}

										{/* Title Selection */}
										{m.titleSelection &&
											m
												.titleSelection
												.titles &&
											m
												.titleSelection
												.titles
												.length >
												0 && (
												<TitleSelection
													titles={
														m
															.titleSelection
															.titles
													}
													agent={
														agent
													}
													completedSelections={
														completedSelections
													}
													setCompletedSelections={
														setCompletedSelections
													}
													setMessages={
														setMessages
													}
													setAgent={
														setAgent
													}
													updateData={
														updateData
													}
													setIsThinking={
														setIsThinking
													}
													setOutline={
														setOutline
													}
													setDraft={
														setDraft
													}
													setTraceItems={
														setTraceItems
													}
												/>
											)}

										{/* Interlinking Form */}
										{m.interlinkingForm && (
											<InterlinkingForm
												currentLinks={
													m
														.interlinkingForm
														.currentLinks ||
													[]
												}
												agent={
													agent
												}
												data={
													data
												}
												completedSelections={
													completedSelections
												}
												setCompletedSelections={
													setCompletedSelections
												}
												setMessages={
													setMessages
												}
												messages={
													messages
												}
												setAgent={
													setAgent
												}
												updateData={
													updateData
												}
												setIsThinking={
													setIsThinking
												}
												setOutline={
													setOutline
												}
												setDraft={
													setDraft
												}
												setTraceItems={
													setTraceItems
												}
											/>
										)}

										{/* References Form */}
										{m.referencesForm && (
											<ReferencesForm
												currentUrls={
													m
														.referencesForm
														.currentUrls ||
													[]
												}
												currentFiles={
													m
														.referencesForm
														.currentFiles ||
													[]
												}
												agent={
													agent
												}
												data={
													data
												}
												completedSelections={
													completedSelections
												}
												setCompletedSelections={
													setCompletedSelections
												}
												setMessages={
													setMessages
												}
												setAgent={
													setAgent
												}
												updateData={
													updateData
												}
												setIsThinking={
													setIsThinking
												}
												setOutline={
													setOutline
												}
												setDraft={
													setDraft
												}
												setTraceItems={
													setTraceItems
												}
											/>
										)}

										{/* Outline Approval */}
										{m.outlineApproval &&
											m
												.outlineApproval
												.outline && (
												<OutlineApproval
													outline={
														m
															.outlineApproval
															.outline
													}
													agent={
														agent
													}
													completedSelections={
														completedSelections
													}
													setCompletedSelections={
														setCompletedSelections
													}
													setMessages={
														setMessages
													}
													messages={
														messages
													}
													setAgent={
														setAgent
													}
													updateData={
														updateData
													}
													setOutline={
														setOutline
													}
													setIsThinking={
														setIsThinking
													}
													setDraft={
														setDraft
													}
													setTraceItems={
														setTraceItems
													}
													setInput={
														setInput
													}
													setOutlineApproved={
														setOutlineApproved
													}
													setViewMode={
														setViewMode
													}
												/>
											)}

										{/* Control Level Selection - Removed as we now use intelligent flow detection */}
									</div>
								</div>
							))}
							{isThinking && (
								<div className='flex justify-start mb-4'>
									<div className='bg-gray-100 text-gray-800 max-w-[75%] px-4 py-2.5 rounded-xl flex items-center gap-2'>
										<Spinner className='w-4 h-4' />
										<span className='text-sm'>
											Thinking...
										</span>
									</div>
								</div>
							)}
							<div ref={scrollRef} />
						</div>

						{/* Floating Input Box */}
						<div className='sticky bottom-0 left-0 right-0 py-4 bg-gradient-to-t from-white via-white to-transparent'>
							<div className='max-w-3xl mx-auto px-4'>
								<div className='flex gap-2 items-end p-3 rounded-2xl border border-gray-300 bg-white shadow-lg focus-within:border-orange-400 focus-within:shadow-xl transition-all'>
									<textarea
										value={input}
										onChange={(e) =>
											setInput(
												e.target
													.value
											)
										}
										onKeyDown={(e) => {
											if (
												e.key ===
													'Enter' &&
												!e.shiftKey
											) {
												e.preventDefault();
												if (
													canSend &&
													!isThinking
												) {
													handleSend();
												}
											}
										}}
										rows={1}
										disabled={
											isInputLocked
										}
										placeholder={
											outlineApproved
												? 'Chat disabled - Blog generation in progress...'
												: isStreaming
												? 'Assistant is streaming response...'
												: isThinking
												? 'Assistant is responding...'
												: 'Message Bloggr AI...'
										}
										className={`flex-1 px-2 py-2 border-0 focus:ring-0 focus:outline-none resize-none bg-transparent text-gray-900 placeholder-gray-400 ${
											isInputLocked
												? 'cursor-not-allowed opacity-60'
												: ''
										}`}
										style={
											inputTextareaStyles
										}
									/>
									<button
										onClick={handleSend}
										disabled={
											!canSend ||
											isThinking ||
											isStreaming
										}
										className='p-2 text-white bg-orange-500 rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-orange-500'
										title='Send message'
									>
										<svg
											className='w-5 h-5'
											fill='none'
											stroke='currentColor'
											viewBox='0 0 24 24'
										>
											<path
												strokeLinecap='round'
												strokeLinejoin='round'
												strokeWidth={
													2
												}
												d='M5 12h14M12 5l7 7-7 7'
											/>
										</svg>
									</button>
								</div>
								{isThinking &&
									!outlineApproved && (
										<div className='mt-2 flex items-center gap-2 text-xs text-gray-500 px-4'>
											<Spinner className='w-3 h-3' />
											<span>
												Assistant
												is
												responding...
											</span>
										</div>
									)}
							</div>
						</div>
					</div>

					{/* Draft + SEO */}
					{showBlogContent && (
						<div className='flex flex-col min-h-0 w-[70%] transition-all duration-700 ease-in-out animate-[slideIn_0.7s_ease-out] border-2 border-orange-300 rounded-xl bg-white p-4 shadow-lg'>
							<div className='flex items-center justify-between mb-2'>
								<div className='flex items-center gap-2'>
									<h3 className='text-lg font-semibold text-gray-800'>
										Blog Content
									</h3>
									{/* SEO Info Button */}
									{seoScore !== null &&
										(seoPrimary ||
											seoCritical) && (
											<div className='relative group'>
												<button className='w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-xs font-bold hover:bg-blue-200 transition-colors flex items-center justify-center'>
													i
												</button>
												<div className='absolute left-0 top-6 w-80 bg-white border border-gray-200 rounded-lg shadow-lg p-4 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50'>
													<div className='space-y-3 text-sm'>
														{seoPrimary && (
															<div className='p-3 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-lg'>
																<div className='flex items-center gap-2 mb-1'>
																	<span className='text-base'>
																		⭐
																	</span>
																	<span className='font-bold text-blue-700'>
																		Primary
																		Ranking
																		Factor
																	</span>
																</div>
																<p className='text-gray-700 text-xs'>
																	{
																		seoPrimary
																	}
																</p>
															</div>
														)}
														{seoCritical && (
															<div className='p-3 bg-gradient-to-br from-red-50 to-orange-50 border border-red-200 rounded-lg'>
																<div className='flex items-center gap-2 mb-1'>
																	<span className='text-base'>
																		⚠️
																	</span>
																	<span className='font-bold text-red-700'>
																		Most
																		Critical
																		Flaw
																	</span>
																</div>
																<p className='text-gray-700 text-xs'>
																	{
																		seoCritical
																	}
																</p>
															</div>
														)}
													</div>
												</div>
											</div>
										)}
								</div>
								<div className='flex items-center gap-3'>
									{/* View Mode Toggle */}
									{draft.trim() && (
										<div className='flex gap-1 bg-gray-100 rounded-md p-1'>
											<button
												onClick={() =>
													setViewMode(
														'markdown'
													)
												}
												className={`px-3 py-1 text-xs rounded ${
													viewMode ===
													'markdown'
														? 'bg-orange-500 text-white'
														: 'text-gray-600 hover:bg-gray-200'
												}`}
											>
												Preview
											</button>
											<button
												onClick={() =>
													setViewMode(
														'blog'
													)
												}
												className={`px-3 py-1 text-xs rounded ${
													viewMode ===
													'blog'
														? 'bg-orange-500 text-white'
														: 'text-gray-600 hover:bg-gray-200'
												}`}
											>
												Raw
											</button>
										</div>
									)}
									{/* SEO Score */}
									{isRanking ? (
										<div className='flex items-center gap-2 text-gray-500 text-sm bg-white px-4 py-2 rounded-full shadow-md'>
											<Spinner />
											<span className='font-medium'>
												Scoring
												SEO…
											</span>
										</div>
									) : seoScore !== null ? (
										<div className='flex items-center gap-2 px-4 py-2 rounded-full shadow-lg bg-gradient-to-r from-orange-500 to-orange-600 text-white'>
											<span className='text-lg'>
												🎯
											</span>
											<span className='font-bold text-base'>
												SEO:{' '}
												{
													seoScore
												}
												/100
											</span>
										</div>
									) : (
										<div className='text-sm text-gray-400 italic'>
											SEO score
											unavailable
										</div>
									)}
								</div>
							</div>

							{/* Content Display - Outline now shown in chat only */}
							{viewMode === 'markdown' ? (
								/* Show Markdown Preview */
								<div className='flex-1 overflow-y-auto border rounded-md p-4 bg-white prose prose-sm max-w-none markdown-preview'>
									{draft.trim() ? (
										<div className='markdown-content'>
											<ReactMarkdown>
												{draft}
											</ReactMarkdown>
										</div>
									) : (
										<div className='flex items-center justify-center h-full text-gray-400'>
											{isThinking ? (
												<div className='flex flex-col items-center gap-3'>
													<Spinner className='w-8 h-8' />
													<p>
														Generating
														content...
													</p>
												</div>
											) : (
												<p>
													Content
													will
													appear
													here
													as
													the
													agent
													writes...
												</p>
											)}
										</div>
									)}
								</div>
							) : (
								/* Show Raw Markdown */
								<textarea
									value={draft}
									onChange={(e) =>
										setDraft(
											e.target.value
										)
									}
									className='flex-1 p-3 border rounded-md focus:ring-orange-500 focus:border-orange-500 font-mono text-sm'
									placeholder='# Your Blog Title\n\nContent will appear here as the agent writes...'
								/>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

export default AgentMode;
