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
import {
	BlogData,
	Interlink,
	OutlineSection,
	AutomationLevel,
	ChatMessage,
	ReferenceFile,
} from '../types';

interface Props {
	data: BlogData;
	updateData: (data: Partial<BlogData>) => void;
	showBlogInfo: boolean;
	showTrace: boolean;
}

// Helper function to convert file to base64
const fileToBase64 = (file: File): Promise<string> => {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.readAsDataURL(file);
		reader.onload = () => {
			const result = reader.result as string;
			// Remove "data:mime/type;base64," prefix
			resolve(result.split(',')[1]);
		};
		reader.onerror = (error) => reject(error);
	});
};

// Helper function to convert trace steps to user-friendly messages
const getStepMessage = (
	step: string,
	info?: Record<string, any>
): string | null => {
	const messages: Record<string, string> = {
		'KeywordResearch.primaryCandidates': `🔍 Researched ${
			info?.count || 0
		} keyword options`,
		'KeywordResearch.autoSelected': `✅ Selected "${info?.keyword}" as primary keyword`,
		'KeywordResearch.userProvided': `✅ Using your keyword: "${info?.keyword}"`,
		'KeywordResearch.secondaryCandidates': `🔍 Found ${
			info?.count || 0
		} secondary keyword options`,
		'KeywordResearch.secondaryAutoSelected': `✅ Selected ${
			info?.count || 0
		} secondary keywords`,
		'KeywordResearch.secondaryUserProvided': `✅ Using your ${
			info?.count || 0
		} secondary keywords`,
		'TitleGeneration.generated': `📝 Generated ${
			info?.count || 0
		} title options`,
		'TitleGeneration.autoSelected': `✅ Selected title: "${info?.title}"`,
		'TitleGeneration.userProvided': `✅ Using your title: "${info?.title}"`,
		'Interlinking.prompted': `🔗 Ready to add internal/external links (optional)`,
		'Interlinking.autoSkipped': `⏭️ Skipped interlinking step`,
		'Interlinking.userProvided': `✅ Added ${info?.count || 0} links`,
		'ReferencesCollection.prompted': `📚 Ready to add reference URLs (optional)`,
		'ReferencesCollection.autoSkipped': `⏭️ Skipped references step`,
		'ReferencesCollection.userProvided': `✅ Added ${
			info?.count || 0
		} references`,
		'DiscoveryNode.generatedOutline': `📋 Generated outline with ${
			info?.h2Count || 0
		} sections`,
		'DiscoveryNode.regeneratedOutline': `🔄 Regenerated outline with ${
			info?.h2Count || 0
		} sections based on your feedback`,
		'ProposalNode.generatedSection': `✍️ Writing section ${
			(info?.sectionIndex || 0) + 1
		}: ${info?.section}`,
		'FinalBlog.generated': `🎉 Blog complete! ${
			info?.wordCount || 0
		} words`,
		'EstimatorNode.ranked': `📊 SEO analysis complete`,
	};

	return messages[step] || null;
};

const markdownStyles = `
	.markdown-preview .markdown-content h1 {
		font-size: 2rem;
		font-weight: bold;
		margin-bottom: 1rem;
		color: #1a1a1a;
	}
	.markdown-preview .markdown-content h2 {
		font-size: 1.5rem;
		font-weight: bold;
		margin-top: 1.5rem;
		margin-bottom: 0.75rem;
		color: #2d3748;
	}
	.markdown-preview .markdown-content h3 {
		font-size: 1.25rem;
		font-weight: 600;
		margin-top: 1rem;
		margin-bottom: 0.5rem;
		color: #4a5568;
	}
	.markdown-preview .markdown-content p {
		margin-bottom: 0.75rem;
		color: #4a5568;
		line-height: 1.7;
	}
	.markdown-preview .markdown-content ul,
	.markdown-preview .markdown-content ol {
		margin-left: 1.5rem;
		margin-bottom: 0.75rem;
		list-style-position: outside;
	}
	.markdown-preview .markdown-content ul {
		list-style-type: disc;
	}
	.markdown-preview .markdown-content ol {
		list-style-type: decimal;
	}
	.markdown-preview .markdown-content li {
		margin-bottom: 0.25rem;
		color: #4a5568;
	}
	.markdown-preview .markdown-content a {
		color: #2563eb;
		text-decoration: underline;
	}
	.markdown-preview .markdown-content a:hover {
		color: #1d4ed8;
	}
	.markdown-preview .markdown-content blockquote {
		border-left: 4px solid #cbd5e0;
		padding-left: 1rem;
		font-style: italic;
		margin: 1rem 0;
		color: #718096;
	}
	.markdown-preview .markdown-content code {
		background-color: #f7fafc;
		padding: 0.125rem 0.25rem;
		border-radius: 0.25rem;
		font-size: 0.875rem;
		font-family: monospace;
	}
	.markdown-preview .markdown-content pre {
		background-color: #f7fafc;
		padding: 1rem;
		border-radius: 0.5rem;
		overflow-x: auto;
		margin: 1rem 0;
	}
	.markdown-preview .markdown-content table {
		width: 100%;
		border-collapse: collapse;
		margin: 1rem 0;
	}
	.markdown-preview .markdown-content th,
	.markdown-preview .markdown-content td {
		border: 1px solid #cbd5e0;
		padding: 0.5rem 1rem;
	}
	.markdown-preview .markdown-content th {
		background-color: #f7fafc;
		font-weight: 600;
	}
	.markdown-preview .markdown-content strong {
		font-weight: 700;
	}
	.markdown-preview .markdown-content em {
		font-style: italic;
	}
`;

const AgentMode: React.FC<Props> = ({
	data,
	updateData,
	showBlogInfo,
	showTrace,
}) => {
	const apiKey = data.apiKey;
	const interlinks: Interlink[] = data.interlinks;
	const [automationMode, setAutomationMode] =
		useState<AutomationLevel | null>(null); // null means not selected yet
	const [messages, setMessages] = useState<ChatMessage[]>([
		{
			role: 'assistant',
			content: "Hi! I'm your Blog Agent. Tell me what you want to write about and I'll help you create an SEO-optimized blog.\n\nExamples:\n• 'Write a blog about cloud computing'\n• 'Topic: AI in healthcare, Keyword: machine learning'\n• 'Generate a blog on databases for United States'",
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
	const [isThinking, setIsThinking] = useState(false);
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

	const scrollRef = useRef<HTMLDivElement>(null);

	// ✨ Allow sending during outline approval (for feedback), but disable after approval
	const canSend = useMemo(() => {
		if (!input.trim() || !apiKey) return false;

		// If outline is approved and blog generation has started, disable chat
		if (outlineApproved) return false;

		// Otherwise, allow chat (including during outline approval for feedback)
		return true;
	}, [input, apiKey, outlineApproved]);

	useEffect(() => {
		scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages, isThinking]);

	// Debounced SEO ranking
	useEffect(() => {
		if (!apiKey || !draft.trim()) {
			setSeoScore(null);
			setSeoPrimary('');
			setSeoCritical('');
			return;
		}
		const handle = setTimeout(async () => {
			try {
				setIsRanking(true);
				const report = await geminiService.rankBlogPost(
					draft,
					data.primaryKeyword || userTopic,
					apiKey,
					'gemini-flash-latest'
				);
				setSeoScore(report.finalSeoScore);
				setSeoPrimary(report.primaryRankingFactor);
				setSeoCritical(report.mostCriticalFlaw);
			} catch (e) {
				// swallow ranking errors to not block chat
			} finally {
				setIsRanking(false);
			}
		}, 800);
		return () => clearTimeout(handle);
	}, [draft, data.primaryKeyword, userTopic, apiKey]);

	const handleSend = useCallback(async () => {
		if (!canSend) return;
		if (!apiKey) {
			setError(
				'Please set your Gemini API Key in the Wizard first.'
			);
			return;
		}
		setError(null);
		const userMsg: ChatMessage = {
			role: 'user',
			content: input.trim(),
		};

		// ✨ Check if control level is not set yet (first message)
		if (automationMode === null && !agent) {
			// Detect if user provided detailed information
			const hasDetailedInfo =
				/keyword|title|location|country|reference|link|url|target|primary|secondary/i.test(
					input.trim()
				);

			if (hasDetailedInfo) {
				// Auto-select Guided mode if user provides detailed info
				setAutomationMode('guided');
				setMessages((prev) => [
					...prev,
					userMsg,
					{
						role: 'assistant',
						content: "🎯 I can see you have specific requirements. I'll use Guided mode where you approve key decisions. Let me process this...",
					},
				]);
				setInput('');
				setIsThinking(true);
			} else {
				// Ask for control level if just a simple topic
				setMessages((prev) => [
					...prev,
					userMsg,
					{
						role: 'assistant',
						content: '⚙️ Before we begin, how would you like me to help you?',
						controlLevelSelection: true,
					},
				]);
				setInput('');
				return; // Don't proceed until control level is selected
			}
		} else {
			// Control level already set, proceed normally
			setMessages((prev) => [...prev, userMsg]);
			setInput('');
			setIsThinking(true);
		}

		try {
			// Initialize agent state if this is the first actionable turn
			let working =
				agent ??
				({
					data: {
						...data,
						topic: userTopic || '',
						targetLocation: targetLocation,
						primaryKeyword: '',
						secondaryKeywords: [],
						title: '',
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
						automationLevel: automationMode || 'guided', // Default to guided if still null
						skipOptionalSteps: false,
						autoSelectBestOptions: false,
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
					automationMode || 'guided' // Pass the user's selected automation mode
				);

			// Show assistant's interpretation/response
			setMessages((prev) => [
				...prev,
				{
					role: 'assistant',
					content: conversationResponse.assistantMessage,
				},
			]);

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
						setOutlineApproved(true);
						setViewMode('markdown');
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
							content: '🎯 Please select a primary keyword from the options below:',
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
							content: '🎯 Select up to 5 secondary keywords:',
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
								content: '📝 Select a blog title from the options below:',
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
	]);

	const handleSaveToWizard = () => {
		updateData({ blogContent: draft, outline });
	};

	const handleGenerateOutline = async () => {
		// Deprecated: Prefer running via LangGraph. Kept for manual use if needed.
		if (!apiKey) {
			setError(
				'Please set your Gemini API Key in the Wizard first.'
			);
			return;
		}
		setError(null);
		setIsThinking(true);
		try {
			const freshOutline = await geminiService.generateOutline(
				{
					...data,
					topic: userTopic,
					targetLocation: targetLocation,
					primaryKeyword: data.primaryKeyword || userTopic,
					outline: [],
				},
				apiKey
			);
			setOutline(freshOutline);
		} catch (e: any) {
			setError(e?.message || 'Failed to generate outline.');
		} finally {
			setIsThinking(false);
		}
	};

	const handleGenerateFullDraft = async () => {
		if (!apiKey) {
			setError(
				'Please set your Gemini API Key in the Wizard first.'
			);
			return;
		}
		if (!outline || outline.length === 0) {
			setError('Generate and approve an outline first.');
			return;
		}
		setError(null);
		setIsThinking(true);
		try {
			const content = await geminiService.generateBlogPost(
				{
					...data,
					topic: userTopic,
					targetLocation: targetLocation,
					primaryKeyword: data.primaryKeyword || userTopic,
					interlinks,
				},
				outline,
				apiKey
			);
			setDraft(content);
			updateData({ blogContent: content, outline });
		} catch (e: any) {
			setError(e?.message || 'Failed to generate full draft.');
		} finally {
			setIsThinking(false);
		}
	};

	return (
		<div className='h-full bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200/50'>
			{/* Inject markdown styles */}
			<style>{markdownStyles}</style>

			<div className='flex-1 overflow-auto px-6 py-5 bg-gradient-to-br from-gray-50/50 to-white'>
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
								{automationMode === 'full'
									? '🚀 Full Automation'
									: automationMode ===
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
										automationMode ===
										'full'
									}
									disabled={!!agent}
									onChange={(e) =>
										setAutomationMode(
											e.target
												.value as AutomationLevel
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
										automationMode ===
										'guided'
									}
									disabled={!!agent}
									onChange={(e) =>
										setAutomationMode(
											e.target
												.value as AutomationLevel
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
										automationMode ===
										'manual'
									}
									disabled={!!agent}
									onChange={(e) =>
										setAutomationMode(
											e.target
												.value as AutomationLevel
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
									setOutlineApproved(true);
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

				{/* Blog Info Panel */}
				<div className='mt-4'>
					{showBlogInfo && (
						<div className='mt-2 p-3 border rounded bg-blue-50 text-xs'>
							{agent && (
								<div className='space-y-2'>
									{/* Primary Keyword */}
									{agent.data
										.primaryKeyword && (
										<div>
											<span className='font-semibold text-gray-700'>
												Primary
												Keyword:
											</span>{' '}
											<span className='text-blue-700'>
												{
													agent
														.data
														.primaryKeyword
												}
											</span>
										</div>
									)}

									{/* Secondary Keywords */}
									{agent.data
										.secondaryKeywords &&
										agent.data
											.secondaryKeywords
											.length >
											0 && (
											<div>
												<span className='font-semibold text-gray-700'>
													Secondary
													Keywords:
												</span>{' '}
												<span className='text-blue-700'>
													{agent.data.secondaryKeywords.join(
														', '
													)}
												</span>
											</div>
										)}

									{/* Title */}
									{agent.data.title && (
										<div>
											<span className='font-semibold text-gray-700'>
												Title:
											</span>{' '}
											<span className='text-blue-700'>
												{
													agent
														.data
														.title
												}
											</span>
										</div>
									)}

									{/* Outline */}
									{agent.outline &&
										agent.outline
											.length >
											0 && (
											<div>
												<div className='font-semibold text-gray-700 mb-1'>
													Outline:
												</div>
												<div className='ml-2 space-y-1'>
													{agent.outline.map(
														(
															section,
															idx
														) => (
															<div
																key={
																	section.id
																}
															>
																<div className='text-blue-700'>
																	{idx +
																		1}

																	.{' '}
																	{
																		section.name
																	}
																</div>
																{section.items &&
																	section
																		.items
																		.length >
																		0 && (
																		<div className='ml-3 text-gray-600'>
																			{section.items.map(
																				(
																					item
																				) => (
																					<div
																						key={
																							item.id
																						}
																					>
																						•{' '}
																						{
																							item.name
																						}
																					</div>
																				)
																			)}
																		</div>
																	)}
															</div>
														)
													)}
												</div>
											</div>
										)}

									{!agent.data
										.primaryKeyword &&
										!agent.data.title &&
										(!agent.outline ||
											agent.outline
												.length ===
												0) && (
											<div className='text-gray-500'>
												No blog
												info
												yet.
												Start by
												sending
												a
												message.
											</div>
										)}
								</div>
							)}
							{!agent && (
								<div className='text-gray-500'>
									Start a conversation to
									see blog generation info.
								</div>
							)}
						</div>
					)}
				</div>

				{/* Trace Panel */}
				<div className='mt-4'>
					{showTrace && (
						<div className='mt-2 p-2 border rounded bg-gray-50 max-h-40 overflow-auto text-xs text-gray-700'>
							{traceItems.length === 0 && (
								<div>No steps yet.</div>
							)}
							{traceItems.map((t, idx) => (
								<div key={idx}>
									{new Date(
										t.at
									).toLocaleTimeString()}
									: {t.step}
								</div>
							))}
						</div>
					)}
				</div>

				<div className='grid grid-cols-1 lg:grid-cols-2 gap-6 h-full'>
					{/* Chat + Input */}
					<div className='flex flex-col min-h-0'>
						<div className='flex-1 overflow-y-auto border-2 border-gray-200 rounded-2xl p-4 bg-gradient-to-br from-gray-50 to-white shadow-inner'>
							{messages.map((m, i) => (
								<div
									key={i}
									className={`mb-4 ${
										m.role === 'user'
											? 'text-right'
											: 'text-left'
									}`}
								>
									<div
										className={`inline-block px-5 py-3 rounded-2xl text-sm whitespace-pre-wrap shadow-lg ${
											m.role ===
											'user'
												? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white max-w-[80%]'
												: m.keywordSelection
												? 'bg-amber-50 border-2 border-amber-200 max-w-full w-full'
												: m.titleSelection
												? 'bg-purple-50 border-2 border-purple-200 max-w-full w-full'
												: m.interlinkingForm
												? 'bg-green-50 border-2 border-green-200 max-w-full w-full'
												: m.referencesForm
												? 'bg-yellow-50 border-2 border-yellow-300 max-w-full w-full'
												: m.outlineApproval
												? 'bg-blue-50 border-2 border-blue-300 max-w-full w-full'
												: m.controlLevelSelection
												? 'bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 border-2 border-purple-300 max-w-full w-full'
												: 'bg-white border border-gray-200 max-w-[80%]'
										}`}
									>
										{m.content}

										{/* Primary Keyword Selection */}
										{m.keywordSelection
											?.type ===
											'primary' && (
											<div className='mt-3 grid grid-cols-1 md:grid-cols-2 gap-2'>
												{m.keywordSelection.candidates.map(
													(
														kw,
														idx
													) => (
														<div
															key={
																idx
															}
															className='flex items-center justify-between text-sm bg-white border rounded p-2'
														>
															<div>
																<div className='font-medium text-gray-800'>
																	{
																		kw.text
																	}
																</div>
																<div className='text-xs text-gray-500'>
																	Vol:{' '}
																	{
																		kw.volume
																	}{' '}
																	·
																	Diff:{' '}
																	{kw.difficulty.toFixed(
																		2
																	)}
																</div>
															</div>
															<button
																className='px-3 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors'
																onClick={async () => {
																	if (
																		!agent
																	)
																		return;

																	setMessages(
																		(
																			prev
																		) => [
																			...prev,
																			{
																				role: 'user',
																				content: `Select "${kw.text}" as primary keyword`,
																			},
																			{
																				role: 'assistant',
																				content: `✅ Selected "${kw.text}" as primary keyword. Continuing...`,
																			},
																		]
																	);

																	const next =
																		{
																			...agent,
																			data: {
																				...agent.data,
																				primaryKeyword:
																					kw.text,
																			},
																		} as AgentState;
																	setAgent(
																		next
																	);
																	updateData(
																		{
																			primaryKeyword:
																				kw.text,
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

																			// Break if halted and needs user input
																			if (
																				halted &&
																				automationEngine.needsUserInput(
																					ns
																				)
																			) {
																				break;
																			}
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
																						content: '🎯 Select up to 5 secondary keywords:',
																						keywordSelection:
																							{
																								type: 'secondary',
																								candidates:
																									working.keywordResearch?.secondaryCandidates?.slice(
																										0,
																										12
																									) ||
																									[],
																							},
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
													)
												)}
											</div>
										)}

										{/* Secondary Keyword Selection */}
										{m.keywordSelection
											?.type ===
											'secondary' && (
											<>
												<div className='mt-3 grid grid-cols-1 md:grid-cols-2 gap-2'>
													{m.keywordSelection.candidates.map(
														(
															kw,
															idx
														) => {
															const checked =
																selectedSecondaries.includes(
																	kw.text
																);
															return (
																<label
																	key={
																		idx
																	}
																	className='flex items-center justify-between text-sm bg-white border rounded p-2 cursor-pointer hover:bg-gray-50'
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
																									kw.text,
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
																								kw.text
																						);
																					}
																				);
																			}}
																			className='w-4 h-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded'
																		/>
																		<div>
																			<div className='font-medium text-gray-800'>
																				{
																					kw.text
																				}
																			</div>
																			<div className='text-xs text-gray-500'>
																				Vol:{' '}
																				{
																					kw.volume
																				}{' '}
																				·
																				Diff:{' '}
																				{kw.difficulty.toFixed(
																					2
																				)}
																			</div>
																		</div>
																	</div>
																</label>
															);
														}
													)}
												</div>
												<div className='mt-3 text-right'>
													<button
														className='px-4 py-2 text-sm bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors disabled:bg-orange-300 disabled:cursor-not-allowed'
														disabled={
															selectedSecondaries.length ===
															0
														}
														onClick={async () => {
															if (
																!agent
															)
																return;

															setMessages(
																(
																	prev
																) => [
																	...prev,
																	{
																		role: 'user',
																		content: `Selected ${
																			selectedSecondaries.length
																		} secondary keywords: ${selectedSecondaries.join(
																			', '
																		)}`,
																	},
																	{
																		role: 'assistant',
																		content: `✅ Added ${selectedSecondaries.length} secondary keywords. Continuing...`,
																	},
																]
															);

															const next =
																{
																	...agent,
																	data: {
																		...agent.data,
																		secondaryKeywords:
																			selectedSecondaries,
																	},
																} as AgentState;
															setAgent(
																next
															);
															updateData(
																{
																	secondaryKeywords:
																		selectedSecondaries,
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

																	// Break if halted and needs user input
																	if (
																		halted &&
																		automationEngine.needsUserInput(
																			ns
																		)
																	) {
																		break;
																	}
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
																		title: working
																			.data
																			.title,
																	}
																);

																// ✨ Display title selection UI if needed
																if (
																	working
																		.halt
																		?.reason ===
																		'await_title_selection' &&
																	working.titleOptions &&
																	working
																		.titleOptions
																		.length >
																		0
																) {
																	setMessages(
																		(
																			prev
																		) => [
																			...prev,
																			{
																				role: 'assistant',
																				content: '📝 Select a blog title from the options below:',
																				titleSelection:
																					{
																						titles: working.titleOptions,
																					},
																			},
																		]
																	);
																}

																// ✨ Display interlinking UI if needed
																if (
																	working
																		.halt
																		?.reason ===
																	'await_interlinking'
																) {
																	setMessages(
																		(
																			prev
																		) => [
																			...prev,
																			{
																				role: 'assistant',
																				content: '🔗 Add internal/external links (optional) or click "Continue" to skip:',
																				interlinkingForm:
																					{
																						currentLinks:
																							working
																								.data
																								.interlinks ||
																							[],
																					},
																			},
																		]
																	);
																}

																// ✨ Display references form if needed
																if (
																	working
																		.halt
																		?.reason ===
																	'await_references'
																) {
																	setMessages(
																		(
																			prev
																		) => [
																			...prev,
																			{
																				role: 'assistant',
																				content: '📚 Add reference materials (URLs or files) to improve content quality, or click "Continue" to skip:',
																				referencesForm:
																					{
																						currentUrls:
																							working
																								.data
																								.referenceUrls ||
																							[],
																						currentFiles:
																							working
																								.data
																								.referenceFiles ||
																							[],
																					},
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
														Continue
														(
														{
															selectedSecondaries.length
														}{' '}
														selected)
													</button>
												</div>
											</>
										)}

										{/* Title Selection */}
										{m.titleSelection &&
										m.titleSelection
											.titles &&
										m.titleSelection
											.titles
											.length >
											0 ? (
											<div className='mt-3 space-y-2'>
												{m.titleSelection.titles.map(
													(
														title,
														idx
													) => (
														<div
															key={
																idx
															}
															className='flex items-center justify-between text-sm bg-white border rounded p-3 hover:bg-gray-50 transition-colors'
														>
															<div className='flex-1 font-medium text-gray-800'>
																{
																	title
																}
															</div>
															<button
																className='px-3 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors ml-3'
																onClick={async () => {
																	if (
																		!agent
																	)
																		return;

																	setMessages(
																		(
																			prev
																		) => [
																			...prev,
																			{
																				role: 'user',
																				content: `Select "${title}" as title`,
																			},
																			{
																				role: 'assistant',
																				content: `✅ Selected title. Continuing...`,
																			},
																		]
																	);

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

																			// Break if halted and needs user input
																			if (
																				halted &&
																				automationEngine.needsUserInput(
																					ns
																				)
																			) {
																				break;
																			}
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

																		// ✨ Display interlinking UI if needed
																		if (
																			working
																				.halt
																				?.reason ===
																			'await_interlinking'
																		) {
																			setMessages(
																				(
																					prev
																				) => [
																					...prev,
																					{
																						role: 'assistant',
																						content: '🔗 Add internal/external links (optional) or click "Continue" to skip:',
																						interlinkingForm:
																							{
																								currentLinks:
																									working
																										.data
																										.interlinks ||
																									[],
																							},
																					},
																				]
																			);
																		}

																		// ✨ Display references form if needed
																		if (
																			working
																				.halt
																				?.reason ===
																			'await_references'
																		) {
																			setMessages(
																				(
																					prev
																				) => [
																					...prev,
																					{
																						role: 'assistant',
																						content: '📚 Add reference materials (URLs or files) to improve content quality, or click "Continue" to skip:',
																						referencesForm:
																							{
																								currentUrls:
																									working
																										.data
																										.referenceUrls ||
																									[],
																								currentFiles:
																									working
																										.data
																										.referenceFiles ||
																									[],
																							},
																					},
																				]
																			);
																		}

																		// ✨ Display outline approval if needed
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
																						content: '📋 Outline is ready! Review it below and approve to continue, or provide feedback to regenerate:',
																						outlineApproval:
																							{
																								outline:
																									working.outline ||
																									[],
																							},
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
													)
												)}
											</div>
										) : null}

										{/* Interlinking Form */}
										{m.interlinkingForm && (
											<div className='mt-3'>
												{m
													.interlinkingForm
													.currentLinks &&
													m
														.interlinkingForm
														.currentLinks
														.length >
														0 && (
														<div className='space-y-2 mb-3'>
															{m.interlinkingForm.currentLinks.map(
																(
																	link
																) => (
																	<div
																		key={
																			link.id
																		}
																		className='flex items-center justify-between text-sm bg-white border rounded p-2'
																	>
																		<div>
																			<div className='font-medium text-gray-800'>
																				{
																					link.keyword
																				}
																			</div>
																			<div className='text-xs text-blue-600 break-all'>
																				{
																					link.url
																				}
																			</div>
																		</div>
																		<button
																			className='px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors'
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
																				// Update the message to reflect the change
																				setMessages(
																					(
																						prev
																					) =>
																						prev.map(
																							(
																								msg,
																								i
																							) => {
																								if (
																									i ===
																										messages.length -
																											1 &&
																									msg.interlinkingForm
																								) {
																									return {
																										...msg,
																										interlinkingForm:
																											{
																												currentLinks:
																													data.interlinks.filter(
																														(
																															l
																														) =>
																															l.id !==
																															link.id
																													),
																											},
																									};
																								}
																								return msg;
																							}
																						)
																				);
																			}}
																		>
																			Remove
																		</button>
																	</div>
																)
															)}
														</div>
													)}

												<div className='flex gap-2 mb-3'>
													<input
														type='text'
														placeholder='Keyword/Anchor Text'
														value={
															interlinkKeyword
														}
														onChange={(
															e
														) =>
															setInterlinkKeyword(
																e
																	.target
																	.value
															)
														}
														className='flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500'
													/>
													<input
														type='text'
														placeholder='URL'
														value={
															interlinkUrl
														}
														onChange={(
															e
														) =>
															setInterlinkUrl(
																e
																	.target
																	.value
															)
														}
														className='flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500'
													/>
													<button
														className='px-3 py-2 text-sm bg-green-500 text-white rounded hover:bg-green-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed'
														disabled={
															!interlinkKeyword.trim() ||
															!interlinkUrl.trim()
														}
														onClick={() => {
															if (
																interlinkKeyword.trim() &&
																interlinkUrl.trim()
															) {
																const newLink: Interlink =
																	{
																		id: Date.now().toString(),
																		keyword: interlinkKeyword.trim(),
																		url: interlinkUrl.trim(),
																	};
																updateData(
																	{
																		interlinks:
																			[
																				...data.interlinks,
																				newLink,
																			],
																	}
																);
																// Update the message
																setMessages(
																	(
																		prev
																	) =>
																		prev.map(
																			(
																				msg,
																				i
																			) => {
																				if (
																					i ===
																						messages.length -
																							1 &&
																					msg.interlinkingForm
																				) {
																					return {
																						...msg,
																						interlinkingForm:
																							{
																								currentLinks:
																									[
																										...data.interlinks,
																										newLink,
																									],
																							},
																					};
																				}
																				return msg;
																			}
																		)
																);
																setInterlinkKeyword(
																	''
																);
																setInterlinkUrl(
																	''
																);
															}
														}}
													>
														Add
													</button>
												</div>

												<div className='text-right'>
													<button
														className='px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors'
														onClick={async () => {
															if (
																!agent
															)
																return;

															setMessages(
																(
																	prev
																) => [
																	...prev,
																	{
																		role: 'user',
																		content:
																			data
																				.interlinks
																				.length >
																			0
																				? `Added ${data.interlinks.length} link(s). Continue.`
																				: 'Skip interlinking',
																	},
																	{
																		role: 'assistant',
																		content:
																			data
																				.interlinks
																				.length >
																			0
																				? `✅ Added ${data.interlinks.length} internal/external links. Continuing...`
																				: '⏭️ Skipped interlinking. Continuing...',
																	},
																]
															);

															const next =
																{
																	...agent,
																	interlinkingCompleted:
																		true,
																} as AgentState;
															setAgent(
																next
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

																	// Break if halted and needs user input
																	if (
																		halted &&
																		automationEngine.needsUserInput(
																			ns
																		)
																	) {
																		break;
																	}
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

																// ✨ Display references form if needed
																if (
																	working
																		.halt
																		?.reason ===
																	'await_references'
																) {
																	setMessages(
																		(
																			prev
																		) => [
																			...prev,
																			{
																				role: 'assistant',
																				content: '📚 Add reference materials (URLs or files) to improve content quality, or click "Continue" to skip:',
																				referencesForm:
																					{
																						currentUrls:
																							working
																								.data
																								.referenceUrls ||
																							[],
																						currentFiles:
																							working
																								.data
																								.referenceFiles ||
																							[],
																					},
																			},
																		]
																	);
																}

																// ✨ Display outline approval if needed
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
																				content: '📋 Outline is ready! Review it below and approve to continue, or provide feedback to regenerate:',
																				outlineApproval:
																					{
																						outline:
																							working.outline ||
																							[],
																					},
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
														Continue{' '}
														{data
															.interlinks
															.length >
															0 &&
															`(${data.interlinks.length} links)`}
													</button>
												</div>
											</div>
										)}

										{/* References Form */}
										{m.referencesForm && (
											<div className='mt-3'>
												<div className='grid grid-cols-1 md:grid-cols-2 gap-4 mb-4'>
													{/* URLs Section */}
													<div className='bg-white p-3 rounded-md border border-yellow-200'>
														<div className='font-semibold mb-2 text-gray-800 flex items-center gap-2 text-sm'>
															🔗
															Reference
															URLs
														</div>
														{m
															.referencesForm
															.currentUrls
															.length >
															0 && (
															<div className='space-y-2 mb-3 max-h-32 overflow-y-auto'>
																{m.referencesForm.currentUrls.map(
																	(
																		url,
																		idx
																	) => (
																		<div
																			key={
																				idx
																			}
																			className='flex items-center justify-between text-xs bg-gray-50 border rounded p-2'
																		>
																			<span className='truncate flex-1 text-blue-600'>
																				{
																					url
																				}
																			</span>
																			<button
																				className='px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors ml-2'
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
																				Remove
																			</button>
																		</div>
																	)
																)}
															</div>
														)}
														<div className='flex gap-2'>
															<input
																type='text'
																value={
																	currentReferenceUrl
																}
																onChange={(
																	e
																) =>
																	setCurrentReferenceUrl(
																		e
																			.target
																			.value
																	)
																}
																onKeyDown={(
																	e
																) => {
																	if (
																		e.key ===
																			'Enter' &&
																		currentReferenceUrl.trim()
																	) {
																		const url =
																			currentReferenceUrl.trim();
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
																			setCurrentReferenceUrl(
																				''
																			);
																		}
																	}
																}}
																placeholder='https://example.com/article'
																className='flex-grow px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:ring-yellow-500 focus:border-yellow-500'
															/>
															<button
																onClick={() => {
																	if (
																		currentReferenceUrl.trim()
																	) {
																		const url =
																			currentReferenceUrl.trim();
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
																			setCurrentReferenceUrl(
																				''
																			);
																		}
																	}
																}}
																className='px-4 py-2 text-sm bg-gray-200 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-300'
															>
																Add
															</button>
														</div>
													</div>

													{/* Files Section */}
													<div className='bg-white p-3 rounded-md border border-yellow-200'>
														<div className='font-semibold mb-2 text-gray-800 flex items-center gap-2 text-sm'>
															📄
															Upload
															Files
															(PDF/DOCX)
														</div>
														{m
															.referencesForm
															.currentFiles
															.length >
															0 && (
															<div className='space-y-2 mb-3 max-h-32 overflow-y-auto'>
																{m.referencesForm.currentFiles.map(
																	(
																		file,
																		idx
																	) => (
																		<div
																			key={
																				idx
																			}
																			className='flex items-center justify-between text-xs bg-gray-50 border rounded p-2'
																		>
																			<span className='truncate flex-1'>
																				{
																					file.name
																				}
																			</span>
																			<button
																				className='px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors ml-2'
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
																				Remove
																			</button>
																		</div>
																	)
																)}
															</div>
														)}
														<input
															type='file'
															accept='.pdf,.docx'
															onChange={async (
																e
															) => {
																const file =
																	e
																		.target
																		.files?.[0];
																if (
																	file
																) {
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
																		e.target.value =
																			'';
																	} catch (err) {
																		console.error(
																			'Error reading file:',
																			err
																		);
																	}
																}
															}}
															className='block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-yellow-50 file:text-yellow-700 hover:file:bg-yellow-100 cursor-pointer'
														/>
													</div>
												</div>

												<div className='bg-white/70 p-3 rounded-md border border-yellow-200'>
													<div className='text-sm text-gray-700 mb-2'>
														<strong>
															Added:
														</strong>{' '}
														{data
															.referenceUrls
															?.length ||
															0}{' '}
														URL(s),{' '}
														{data
															.referenceFiles
															?.length ||
															0}{' '}
														File(s)
													</div>
													<button
														className='w-full px-4 py-2 text-sm font-semibold bg-gradient-to-r from-yellow-600 to-orange-600 text-white rounded-lg hover:from-yellow-700 hover:to-orange-700 shadow-md hover:shadow-lg transition-all'
														onClick={async () => {
															if (
																!agent
															)
																return;

															setMessages(
																(
																	prev
																) => [
																	...prev,
																	{
																		role: 'user',
																		content:
																			(data
																				.referenceUrls
																				?.length ||
																				0) +
																				(data
																					.referenceFiles
																					?.length ||
																					0) >
																			0
																				? `Added ${
																						data
																							.referenceUrls
																							?.length ||
																						0
																				  } URL(s) and ${
																						data
																							.referenceFiles
																							?.length ||
																						0
																				  } file(s). Continue.`
																				: 'Skip references',
																	},
																	{
																		role: 'assistant',
																		content:
																			(data
																				.referenceUrls
																				?.length ||
																				0) +
																				(data
																					.referenceFiles
																					?.length ||
																					0) >
																			0
																				? `✅ Added reference materials. Continuing...`
																				: '⏭️ Skipped references. Continuing...',
																	},
																]
															);

															const next =
																{
																	...agent,
																	referencesCollected:
																		true,
																} as AgentState;
															setAgent(
																next
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

																	// Break if halted and needs user input
																	if (
																		halted &&
																		automationEngine.needsUserInput(
																			ns
																		)
																	) {
																		break;
																	}
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

																// ✨ Display outline approval if needed
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
																				content: '📋 Outline is ready! Review it below and approve to continue, or provide feedback to regenerate:',
																				outlineApproval:
																					{
																						outline:
																							working.outline ||
																							[],
																					},
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
														{(data
															.referenceUrls
															?.length ||
															0) +
															(data
																.referenceFiles
																?.length ||
																0) >
														0
															? '✅ Continue with References'
															: '⏭️ Skip & Continue'}
													</button>
												</div>
											</div>
										)}

										{/* Outline Approval */}
										{m.outlineApproval &&
											m
												.outlineApproval
												.outline && (
												<div className='mt-3'>
													<div className='bg-white p-4 rounded-md border border-blue-200 mb-4'>
														<div className='font-bold text-lg mb-3 text-gray-800'>
															📋
															Blog
															Outline
														</div>
														<div className='space-y-3 text-sm'>
															{m.outlineApproval.outline.map(
																(
																	section,
																	idx
																) => (
																	<div
																		key={
																			section.id
																		}
																		className='border-l-4 border-blue-400 pl-3'
																	>
																		<div className='font-semibold text-gray-800 mb-1'>
																			{idx +
																				1}

																			.{' '}
																			{
																				section.name
																			}
																		</div>
																		{section.items &&
																			section
																				.items
																				.length >
																				0 && (
																				<ul className='ml-4 space-y-1 text-gray-600'>
																					{section.items.map(
																						(
																							item
																						) => (
																							<li
																								key={
																									item.id
																								}
																								className='text-xs'
																							>
																								•{' '}
																								{
																									item.name
																								}
																							</li>
																						)
																					)}
																				</ul>
																			)}
																	</div>
																)
															)}
														</div>
													</div>

													<div className='flex gap-3'>
														<button
															className='flex-1 px-4 py-3 text-sm font-semibold bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg hover:from-green-700 hover:to-green-800 shadow-md hover:shadow-lg transition-all'
															onClick={async () => {
																if (
																	!agent
																)
																	return;

																setMessages(
																	(
																		prev
																	) => [
																		...prev,
																		{
																			role: 'user',
																			content: 'Approve outline',
																		},
																		{
																			role: 'assistant',
																			content: '✅ Outline approved! Starting blog generation...',
																		},
																	]
																);

																const next =
																	{
																		...agent,
																		outlineApproved:
																			true,
																	} as AgentState;
																setAgent(
																	next
																);
																setOutlineApproved(
																	true
																);
																setViewMode(
																	'markdown'
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
																		50
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

																		// Update live state for progress indicator
																		setAgent(
																			working
																		);
																		setDraft(
																			working.draft
																		);
																		setOutline(
																			working.outline
																		);

																		// Break if halted and needs user input
																		if (
																			halted &&
																			automationEngine.needsUserInput(
																				ns
																			)
																		) {
																			break;
																		}
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

																	// Show completion message
																	if (
																		working.finalBlogGenerated
																	) {
																		setMessages(
																			(
																				prev
																			) => [
																				...prev,
																				{
																					role: 'assistant',
																					content: '🎉 Blog generation complete! Your content is ready in the Live Draft.',
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
															✅
															Approve
															Outline
														</button>
														<button
															className='px-4 py-3 text-sm font-semibold bg-gray-200 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-300 transition-all'
															onClick={() => {
																setInput(
																	'Regenerate the outline with more detail'
																);
															}}
														>
															💬
															Request
															Changes
														</button>
													</div>

													<div className='mt-3 text-xs text-gray-600 bg-blue-50 p-2 rounded'>
														💡{' '}
														<strong>
															Tip:
														</strong>{' '}
														Type
														feedback
														like
														"Add
														a
														section
														about
														X"
														or
														"Make
														it
														more
														technical"
														to
														regenerate
													</div>
												</div>
											)}

										{/* Control Level Selection */}
										{m.controlLevelSelection && (
											<div className='mt-3'>
												<div className='space-y-3'>
													<button
														className='w-full flex items-center justify-between p-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 shadow-md hover:shadow-lg transition-all'
														onClick={() => {
															setAutomationMode(
																'full'
															);
															setMessages(
																(
																	prev
																) => [
																	...prev,
																	{
																		role: 'user',
																		content: 'Full Automation - I decide everything',
																	},
																	{
																		role: 'assistant',
																		content: "🚀 Perfect! I'll handle all decisions automatically. Let's start - what's your blog topic?",
																	},
																]
															);
														}}
													>
														<div className='text-left'>
															<div className='font-bold text-lg'>
																🚀
																Full
																Automation
															</div>
															<div className='text-sm text-blue-100'>
																I
																decide
																everything
																for
																you
															</div>
														</div>
														<div className='text-2xl'>
															→
														</div>
													</button>

													<button
														className='w-full flex items-center justify-between p-4 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg hover:from-purple-600 hover:to-purple-700 shadow-md hover:shadow-lg transition-all'
														onClick={() => {
															setAutomationMode(
																'guided'
															);
															setMessages(
																(
																	prev
																) => [
																	...prev,
																	{
																		role: 'user',
																		content: 'Guided - I approve key decisions',
																	},
																	{
																		role: 'assistant',
																		content: "🎯 Great choice! I'll show you options and you make the final calls. What would you like to write about?",
																	},
																]
															);
														}}
													>
														<div className='text-left'>
															<div className='font-bold text-lg'>
																🎯
																Guided
															</div>
															<div className='text-sm text-purple-100'>
																I
																approve
																key
																decisions
																(Recommended)
															</div>
														</div>
														<div className='text-2xl'>
															→
														</div>
													</button>

													{/* Manual Mode - Commented out for now */}
													{/* <button
													className='w-full flex items-center justify-between p-4 bg-gradient-to-r from-pink-500 to-pink-600 text-white rounded-lg hover:from-pink-600 hover:to-pink-700 shadow-md hover:shadow-lg transition-all'
													onClick={() => {
														setAutomationMode(
															'manual'
														);
														setMessages(
															(
																prev
															) => [
																...prev,
																{
																	role: 'user',
																	content: 'Manual - I control everything',
																},
																{
																	role: 'assistant',
																	content: "✋ Got it! You'll have full control over every step. Tell me what you want to write about.",
																},
															]
														);
													}}
												>
													<div className='text-left'>
														<div className='font-bold text-lg'>
															✋
															Manual
														</div>
														<div className='text-sm text-pink-100'>
															I
															control
															everything
														</div>
													</div>
													<div className='text-2xl'>
														→
													</div>
												</button> */}
												</div>
											</div>
										)}
									</div>
								</div>
							))}
							{isThinking && (
								<div className='flex items-center gap-2 text-sm text-gray-500 mt-2 bg-white/80 backdrop-blur-sm px-4 py-2 rounded-full inline-flex shadow-md'>
									<Spinner className='w-4 h-4' />
									<span className='font-medium'>
										Thinking...
									</span>
								</div>
							)}
							<div ref={scrollRef} />
						</div>

						<div className='mt-4 flex gap-3 bg-white p-2 rounded-2xl border-2 border-gray-200 shadow-lg'>
							<textarea
								value={input}
								onChange={(e) =>
									setInput(e.target.value)
								}
								onKeyDown={(e) => {
									if (
										e.key === 'Enter' &&
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
								rows={2}
								disabled={outlineApproved}
								placeholder={
									outlineApproved
										? '💬 Chat disabled - Blog generation in progress...'
										: '💬 Ask the agent to plan, write a section, refine tone, add examples, etc.'
								}
								className={`flex-1 px-4 py-2 border-0 rounded-xl focus:ring-2 focus:ring-orange-400 focus:outline-none resize-none ${
									outlineApproved
										? 'bg-gray-100 cursor-not-allowed opacity-60'
										: 'bg-gray-50'
								}`}
							/>
							<button
								onClick={handleSend}
								disabled={
									!canSend || isThinking
								}
								className='px-8 py-2 text-sm font-bold text-white bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl hover:shadow-xl hover:shadow-orange-500/40 hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100'
							>
								{isThinking ? '⏳' : '🚀'} Send
							</button>
						</div>
					</div>

					{/* Draft + SEO */}
					<div className='flex flex-col min-h-0'>
						<div className='flex items-center justify-between mb-2'>
							<h3 className='text-lg font-semibold text-gray-800'>
								{!outlineApproved &&
								outline.length > 0
									? 'Outline Preview'
									: 'Blog Content'}
							</h3>
							<div className='flex items-center gap-3'>
								{/* View Mode Toggle */}
								{outlineApproved &&
									draft.trim() && (
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
											Scoring SEO…
										</span>
									</div>
								) : seoScore !== null ? (
									<div className='flex items-center gap-2 px-4 py-2 rounded-full shadow-lg bg-gradient-to-r from-orange-500 to-orange-600 text-white'>
										<span className='text-lg'>
											📊
										</span>
										<span className='font-bold text-base'>
											SEO:{' '}
											{seoScore}/100
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
												here as
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
									setDraft(e.target.value)
								}
								className='flex-1 p-3 border rounded-md focus:ring-orange-500 focus:border-orange-500 font-mono text-sm'
								placeholder='# Your Blog Title\n\nContent will appear here as the agent writes...'
							/>
						)}

						{seoScore !== null && (
							<div className='mt-4 grid grid-cols-1 gap-3 text-sm'>
								<div className='p-4 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl shadow-md'>
									<div className='flex items-center gap-2 mb-1'>
										<span className='text-lg'>
											⭐
										</span>
										<span className='font-bold text-blue-700'>
											Primary
											Ranking Factor
										</span>
									</div>
									<p className='text-gray-700 ml-7'>
										{seoPrimary || '—'}
									</p>
								</div>
								<div className='p-4 bg-gradient-to-br from-red-50 to-orange-50 border border-red-200 rounded-xl shadow-md'>
									<div className='flex items-center gap-2 mb-1'>
										<span className='text-lg'>
											⚠️
										</span>
										<span className='font-bold text-red-700'>
											Most Critical
											Flaw
										</span>
									</div>
									<p className='text-gray-700 ml-7'>
										{seoCritical || '—'}
									</p>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
};

export default AgentMode;
