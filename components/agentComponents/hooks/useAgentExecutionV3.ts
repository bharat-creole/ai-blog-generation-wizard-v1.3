import { useState, useCallback, useRef, useEffect } from 'react';
import { sendMessage, streamMessage } from '../../../services/agentApiClient';
import { AgentState as AgentStateV1 } from '../../../../server/agent/state';
import { ChatMessage } from '../../../types';
import { getStepMessage } from '../utils/agentHelpers';
import { shouldShowProgressMessage } from '../utils/messageUtils';
import { createAssistantMessage } from '../utils/messageUtils';

/**
 * Hook for executing the agent via backend message API
 * This replaces the old execution model with a message-based conversation API
 */
export interface UseAgentExecutionReturn {
	sendUserMessage: (
		message: string,
		currentState: AgentStateV1
	) => Promise<{
		response: string;
		updatedState: AgentStateV1;
		metadata?: Partial<ChatMessage>;
	}>;
	runAgentLoop: (
		working: AgentStateV1,
		maxIterations: number,
		onProgress?: (working: AgentStateV1) => void,
		onStateUpdate?: (working: AgentStateV1) => void
	) => Promise<AgentStateV1>;
}

/**
 * Remove duplicates from trace array
 */
const deduplicateTrace = (trace: any[]): any[] => {
	if (!trace || !Array.isArray(trace)) return [];
	const seen = new Set<string>();
	return trace.filter((item) => {
		const key = `${item.step}-${item.at}-${JSON.stringify(item.info)}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

/**
 * Remove duplicates from toolOutputs array
 */
const deduplicateToolOutputs = (toolOutputs: any[]): any[] => {
	if (!toolOutputs || !Array.isArray(toolOutputs)) return [];
	const seen = new Set<string>();
	return toolOutputs.filter((item) => {
		const key = `${item.type}-${item.timestamp}-${JSON.stringify(
			item.data
		)}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

/**
 * Convert V1 state to backend-compatible format
 * Sanitizes state by removing unnecessary fields and deduplicating arrays
 */
const mapV1ToBackend = (v1: AgentStateV1, apiKey?: string): any => {
	// Deduplicate trace and toolOutputs
	const cleanedTrace = deduplicateTrace(v1.trace || []);
	const cleanedToolOutputs = deduplicateToolOutputs(v1.toolOutputs || []);

	// Only include essential fields in the payload
	return {
		messages: v1.messages.map((m) => ({
			role: m.role,
			content: m.content,
		})),
		data: v1.data,
		// apiKey should be passed separately in request, not stored in state
		// Only include if explicitly provided (for backward compatibility)
		...(apiKey && { apiKey }),
		outline: v1.outline,
		outlineApproved: v1.outlineApproved,
		draft: v1.draft,
		progress: v1.progress,
		preferences: v1.preferences,
		// Only send last 50 trace entries to reduce payload size
		trace: cleanedTrace.slice(-50),
		halt: v1.halt || null,
		userProvidedFields: Array.from(v1.userProvidedFields || []),
		autoFillFields: Array.from(v1.autoFillFields || []),
		// ✨ Map new V2 fields
		currentStep: v1.currentStep,
		// Only send last 10 tool outputs to reduce payload size
		toolOutputs: cleanedToolOutputs.slice(-10),
	};
};

/**
 * Convert backend state to V1 format
 */
const mapBackendToV1 = (
	backend: any,
	originalV1: AgentStateV1
): AgentStateV1 => {
	return {
		...originalV1,
		data: backend.data || originalV1.data,
		outline: backend.outline || originalV1.outline,
		outlineApproved:
			backend.outlineApproved ?? originalV1.outlineApproved,
		draft: backend.draft || originalV1.draft,
		progress: backend.progress || originalV1.progress,
		preferences: backend.preferences || originalV1.preferences,
		trace: backend.trace || originalV1.trace,
		halt: backend.halt,
		userProvidedFields: new Set(backend.userProvidedFields || []),
		autoFillFields: new Set(backend.autoFillFields || []),
		// ✨ Map candidates to V1 structure
		keywordResearch: {
			...originalV1.keywordResearch,
			primaryCandidates: !backend.data?.primaryKeyword
				? backend.keywordCandidates
				: originalV1.keywordResearch?.primaryCandidates,
			secondaryCandidates: backend.data?.primaryKeyword
				? backend.keywordCandidates
				: originalV1.keywordResearch?.secondaryCandidates,
		},
		titleOptions: backend.titleCandidates || originalV1.titleOptions,
		// ✨ Map new V2 fields
		currentStep: backend.currentStep,
		toolOutputs: backend.toolOutputs,
	};
};

export interface UseAgentExecutionV3Options {
	setDraft?: React.Dispatch<React.SetStateAction<string>>;
	setAgent?: React.Dispatch<React.SetStateAction<AgentStateV1 | null>>;
	setOutline?: React.Dispatch<React.SetStateAction<any[]>>;
	updateData?: (data: Partial<any>) => void;
}

export const useAgentExecutionV3 = (
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
	setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>,
	setIsThinking?: React.Dispatch<React.SetStateAction<boolean>>,
	options?: UseAgentExecutionV3Options
): UseAgentExecutionReturn => {
	// Store threadId in a ref to persist across calls
	const threadIdRef = useRef<string | null>(null);
	// Store abort controller to cancel streams on unmount
	const abortControllerRef = useRef<AbortController | null>(null);

	// Direct message sending (new API)
	const sendUserMessage = useCallback(
		async (
			message: string,
			currentState: AgentStateV1,
			apiKey?: string
		): Promise<{
			response: string;
			updatedState: AgentStateV1;
			metadata?: Partial<ChatMessage>;
		}> => {
			// Get apiKey from environment variable as fallback
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			const envApiKey =
				import.meta.env?.VITE_GEMINI_API_KEY ||
				import.meta.env?.GEMINI_API_KEY;

			// Extract apiKey from parameter, state, or environment variable (in that order)
			// API key is optional - backend will use GEMINI_API_KEY from .env if not provided
			const apiKeyToUse =
				apiKey || currentState?.apiKey || envApiKey;
			// No error if apiKey is not provided - backend will use GEMINI_API_KEY from .env
			// Remove apiKey from state before mapping
			const stateWithoutApiKey = { ...currentState };
			delete stateWithoutApiKey.apiKey;
			const backendState = mapV1ToBackend(
				stateWithoutApiKey,
				apiKeyToUse
			);
			// Use existing threadId or create a new one for the session
			if (!threadIdRef.current) {
				threadIdRef.current = `thread-${Date.now()}`;
			}
			const threadId = threadIdRef.current;

			setIsStreaming(true);
			if (setIsThinking) setIsThinking(true);

			// Create new AbortController for this request
			const abortController = new AbortController();
			abortControllerRef.current = abortController;

			try {
				return new Promise((resolve, reject) => {
					let finalState: any = null;
					let finalResponse = '';
					let hasResolved = false;
					let lastTraceLength =
						currentState.trace?.length || 0;
					let accumulatedState: any = { ...currentState };
					let lastShownSectionIndex = -1; // Track last section index we've shown a message for
					let shownPreMessages = new Set<string>(); // Track which pre-messages we've shown
					let writingSectionNumber: number | null = null; // Track which section's "Writing" message is currently streaming
					let pendingCompletionMessages: Map<
						number,
						string
					> = new Map(); // Store completion messages waiting for "Writing" to finish

					// Helper function to check if two arrays are equal
					const arraysEqual = (
						a: any[] | undefined,
						b: any[] | undefined
					): boolean => {
						if (!a || !b) return false;
						if (a.length !== b.length) return false;
						return a.every(
							(val, idx) => val === b[idx]
						);
					};

					// ✨ Message queue system - ensures messages are displayed one at a time
					// Messages wait for the previous message to finish streaming before displaying
					const messageQueue: Array<{
						content: string;
						metadata?: any;
						onStreamingComplete?: () => void;
					}> = [];
					let isProcessingQueue = false;
					let currentMessageStreaming = false;
					let currentMessageCompleteCallback:
						| (() => void)
						| null = null;

					const processMessageQueue = () => {
						// Don't process if already processing or queue is empty
						if (
							isProcessingQueue ||
							messageQueue.length === 0
						) {
							return;
						}

						// Don't process if current message is still streaming
						if (currentMessageStreaming) {
							return;
						}

						isProcessingQueue = true;
						const message = messageQueue.shift();

						if (message) {
							// Mark that we're starting to stream this message
							currentMessageStreaming = true;

							// Create a unique ID for this message to track completion
							const messageId = `msg_${Date.now()}_${Math.random()}`;

							// Add onStreamingComplete callback to metadata
							// Check if this is a "Writing section" message - add extra pause after it
							const isWritingSectionMessage =
								message.content.includes(
									'✍️ Writing section'
								);
							const pauseAfterStreaming =
								isWritingSectionMessage
									? 800
									: 0; // 800ms pause after "Writing section" messages

							// Extract section number from "Writing section X..." message
							if (isWritingSectionMessage) {
								const match =
									message.content.match(
										/Writing section (\d+)/
									);
								if (match) {
									writingSectionNumber =
										parseInt(
											match[1],
											10
										);
								}
							}

							// Create a unique identifier for this message to prevent duplicates
							const messageUniqueId =
								message.metadata
									? `msg_${JSON.stringify(
											message.metadata
									  ).substring(
											0,
											100
									  )}_${Date.now()}`
									: `msg_${Date.now()}_${Math.random()}`;

							const messageMetadata = {
								...(message.metadata || {}),
								_messageUniqueId:
									messageUniqueId, // Add unique ID to track duplicates
								_streamingCompleteCallback:
									() => {
										// Add pause after "Writing section" messages complete
										if (
											pauseAfterStreaming >
												0 &&
											writingSectionNumber !==
												null
										) {
											setTimeout(
												() => {
													// Check if there's a pending completion message for this section
													const pendingMessage =
														pendingCompletionMessages.get(
															writingSectionNumber!
														);
													if (
														pendingMessage
													) {
														pendingCompletionMessages.delete(
															writingSectionNumber!
														);
														// ✨ SIMPLE APPROACH: Keep loader ON - it will only be turned off when all sections are complete
														// Check if all sections are done before turning off
														const currentSectionIndex =
															accumulatedState.progress?.sectionIndex ?? 0;
														const totalSections =
															accumulatedState.outline?.length ?? 0;
														const allSectionsComplete =
															accumulatedState.outlineApproved &&
															accumulatedState.outline &&
															totalSections > 0 &&
															currentSectionIndex >= totalSections;

														if (setIsThinking && !allSectionsComplete) {
															// Keep loader ON during blog generation
															setIsThinking(true);
														}
														
														queueMessage(
															pendingMessage
														);
													} else {
														// No pending message, but keep loader ON if blog generation is still in progress
														const currentSectionIndex =
															accumulatedState.progress?.sectionIndex ?? 0;
														const totalSections =
															accumulatedState.outline?.length ?? 0;
														const allSectionsComplete =
															accumulatedState.outlineApproved &&
															accumulatedState.outline &&
															totalSections > 0 &&
															currentSectionIndex >= totalSections;

														if (setIsThinking && !allSectionsComplete) {
															setIsThinking(true);
														}
													}

													writingSectionNumber =
														null;
													currentMessageStreaming =
														false;
													currentMessageCompleteCallback =
														null;
													isProcessingQueue =
														false;
													// Process next message after pause
													processMessageQueue();
												},
												pauseAfterStreaming
											);
										} else {
											currentMessageStreaming =
												false;
											currentMessageCompleteCallback =
												null;
											isProcessingQueue =
												false;
											// Process next message after current one completes streaming
											processMessageQueue();
										}
									},
								_messageId: messageId,
							};

							// Store callback for this message
							currentMessageCompleteCallback =
								messageMetadata._streamingCompleteCallback;

							// Only add message if it has content or metadata for UI components
							const hasContent =
								message.content &&
								message.content.trim();
							const hasMetadata =
								messageMetadata.keywordSelection ||
								messageMetadata.titleSelection ||
								messageMetadata.interlinkingForm ||
								messageMetadata.referencesForm ||
								messageMetadata.outlineApproval;

							if (hasContent || hasMetadata) {
								setMessages((prev) => {
									const newMessages = [
										...prev,
										{
											role: 'assistant',
											content:
												message.content ||
												'', // Ensure content is at least empty string
											...messageMetadata,
										},
									];
									return newMessages;
								});
							} else {
								// Message is empty and has no metadata - skip it but still process queue
								currentMessageStreaming = false;
								currentMessageCompleteCallback =
									null;
								isProcessingQueue = false;
								processMessageQueue();
							}
						} else {
							isProcessingQueue = false;
						}
					};

					const queueMessage = (
						content: string,
						metadata?: any
					) => {
						// Don't queue empty messages (unless they have metadata for UI components)
						if (!content || !content.trim()) {
							// Only queue if there's metadata (for UI components like keyword selection)
							if (
								!metadata ||
								(!metadata.keywordSelection &&
									!metadata.titleSelection &&
									!metadata.interlinkingForm &&
									!metadata.referencesForm &&
									!metadata.outlineApproval)
							) {
								return; // Skip empty messages without metadata
							}
						}
						messageQueue.push({ content, metadata });
						processMessageQueue();
					};

					const waitForQueueToComplete = (
						callback: () => void
					) => {
						const checkQueue = () => {
							// Wait until queue is empty AND no message is currently streaming
							if (
								messageQueue.length === 0 &&
								!isProcessingQueue &&
								!currentMessageStreaming
							) {
								callback();
							} else {
								setTimeout(checkQueue, 100);
							}
						};
						checkQueue();
					};

					// Helper to get pre-execution message based on current step
					const getPreExecutionMessage = (
						state: any
					): string | null => {
						const currentStep = state.currentStep;
						const haltReason = state.halt?.reason;

						// Check if we're about to execute a node
						if (haltReason) return null; // Don't show if halted

						// Determine which node will execute next based on currentStep
						if (
							currentStep === 'topic' &&
							!state.data?.primaryKeyword
						) {
							return '🔍 Generating primary keywords...';
						}
						if (
							currentStep === 'primary_keyword' &&
							!state.data?.primaryKeyword
						) {
							return '🔍 Generating primary keywords...';
						}
						if (
							currentStep ===
								'secondary_keywords' &&
							(!state.data?.secondaryKeywords ||
								state.data.secondaryKeywords
									.length === 0)
						) {
							return '🔍 Generating secondary keywords...';
						}
						if (
							currentStep === 'title' &&
							!state.data?.title
						) {
							return '📝 Generating title options...';
						}
						if (
							currentStep === 'outline' &&
							(!state.outline ||
								state.outline.length === 0)
						) {
							return '📋 Generating outline...';
						}
						if (
							currentStep === 'generation' &&
							state.outlineApproved
						) {
							const sectionIndex =
								state.progress?.sectionIndex ||
								0;
							if (
								sectionIndex <
								(state.outline?.length || 0)
							) {
								return `✍️ Writing section ${
									sectionIndex + 1
								}...`;
							}
						}

						return null;
					};

					// Track messages from backend to prevent duplicates
					const backendMessages = new Set<string>();

					streamMessage(
						message,
						threadId,
						backendState,
						apiKeyToUse,
						{
							onIntent: (data) => {
								// ✨ NEW: Handle Primary Agent "before execution" messages
								// These are sent BEFORE LangGraph execution starts
								if (
									data.fromPrimaryAgent &&
									data.isBeforeExecution
								) {
									console.log(
										`📨 [INTENT] Primary Agent before-execution message: "${data.assistantMessage?.substring(
											0,
											50
										)}..."`
									);
									if (
										data.assistantMessage &&
										data.assistantMessage.trim()
									) {
										// Track and queue the Primary Agent message immediately
										const msgKey =
											data.assistantMessage.substring(
												0,
												50
											);
										backendMessages.add(
											msgKey
										);
										queueMessage(
											data.assistantMessage
										);
										// Clear finalResponse since we've already queued this message
										finalResponse = '';
									}
									return; // Don't process further - Primary Agent message is handled
								}

								// Initial assistant response (e.g. "I'll handle that...")
								finalResponse =
									data.assistantMessage;

								// ✨ FIX: Add logging to track intent events in production
								console.log('📨 [INTENT] Received intent event:', {
									hasAssistantMessage: !!data.assistantMessage,
									assistantMessageLength: data.assistantMessage?.length || 0,
									shouldRunAgent: data.shouldRunAgent,
									fromPrimaryAgent: data.fromPrimaryAgent,
									hasMultipleMessages: !!(data.assistantMessages && Array.isArray(data.assistantMessages) && data.assistantMessages.length > 1)
								});

								// ✨ NEW: If multiple messages are provided, queue them one at a time
								// This allows separate messages for different steps (e.g., "Got it! I've captured..." + "Let me research keywords...")
								if (
									data.assistantMessages &&
									Array.isArray(
										data.assistantMessages
									) &&
									data.assistantMessages
										.length > 1
								) {
									console.log(
										`📨 [INTENT] Queueing ${data.assistantMessages.length} separate messages:`,
										data.assistantMessages
									);
									// Queue each message to be displayed one at a time
									data.assistantMessages.forEach(
										(msg) => {
											// Track backend messages to prevent frontend duplicates
											const msgKey =
												msg.substring(
													0,
													50
												); // Use first 50 chars as key
											backendMessages.add(
												msgKey
											);
											queueMessage(
												msg
											);
										}
									);
									// Mark that messages were already added, so AgentMode.tsx won't add the single message
									finalResponse = ''; // Clear finalResponse to prevent duplicate
								} else if (finalResponse && finalResponse.trim()) {
									// Track single message too
									const msgKey =
										finalResponse.substring(
											0,
											50
										);
									backendMessages.add(
										msgKey
									);

									// ✨ FIX: If shouldRunAgent is false, queue the message immediately
									// This handles cases where onComplete might not be called or message won't be displayed
									// This is critical for production where network timing can cause messages to be skipped
									if (
										data.shouldRunAgent ===
											false &&
										finalResponse.trim()
									) {
										console.log(
											`📨 [INTENT] Queueing blocked response immediately: "${finalResponse.substring(
												0,
												50
											)}..."`
										);
										queueMessage(
											finalResponse
										);
										finalResponse = ''; // Clear to prevent duplicate
									}
								} else if (!finalResponse || !finalResponse.trim()) {
									// ✨ FIX: Log warning if we receive intent event without a message
									console.warn('⚠️ [INTENT] Received intent event without assistantMessage:', {
										shouldRunAgent: data.shouldRunAgent,
										fromPrimaryAgent: data.fromPrimaryAgent,
										stateUpdates: data.stateUpdates
									});
								}
								// If single message and shouldRunAgent is true, don't add here - it will be added in AgentMode.tsx with metadata
								// This prevents duplicate messages
							},
							onProgress: (chunk) => {
								// Debug: Log chunk structure
								console.log(
									'[PROGRESS CHUNK]',
									{
										chunkKeys:
											Object.keys(
												chunk
											),
										chunkStructure:
											chunk,
									}
								);

								// Extract state from chunk (chunk is usually { nodeName: { ...state } })
								const nodeName =
									Object.keys(chunk)[0];
								const stateUpdate = nodeName
									? chunk[nodeName]
									: chunk;

								console.log(
									'[PROGRESS] Node detected:',
									nodeName,
									{
										hasStateUpdate:
											!!stateUpdate,
										stateUpdateKeys:
											stateUpdate
												? Object.keys(
														stateUpdate
												  )
												: [],
									}
								);

								// Check if we're transitioning from title to outline in full automation - show skipped steps
								const isFullAutomation =
									accumulatedState
										.preferences
										?.automationLevel ===
									'full';
								const wasAtTitle =
									accumulatedState.currentStep ===
										'title' ||
									accumulatedState.currentStep ===
										'title_generation';
								const isMovingToOutline =
									stateUpdate.currentStep ===
										'outline' ||
									nodeName === 'discovery';

								if (
									isFullAutomation &&
									wasAtTitle &&
									isMovingToOutline
								) {
									// Show skipped interlinking message FIRST
									const interlinkingSkippedKey =
										'interlinking_skipped';
									if (
										!shownPreMessages.has(
											interlinkingSkippedKey
										)
									) {
										shownPreMessages.add(
											interlinkingSkippedKey
										);
										queueMessage(
											'⏭️ **Skipped interlinking step**'
										);
									}
									// Show skipped references message SECOND
									const referencesSkippedKey =
										'references_skipped';
									if (
										!shownPreMessages.has(
											referencesSkippedKey
										)
									) {
										shownPreMessages.add(
											referencesSkippedKey
										);
										queueMessage(
											'⏭️ **Skipped references step**'
										);
									}
								}

								// Show pre-execution message when we first detect a node is executing
								// Show it immediately when we see the node name, before merging state
								// For proposal node, track per section to show message for each section
								if (nodeName) {
									// For proposal node, use section-specific key to show message for each section
									let messageKey: string;
									if (
										nodeName ===
										'proposal'
									) {
										const sectionIndex =
											accumulatedState
												.progress
												?.sectionIndex ??
											0;
										messageKey = `pre_${nodeName}_${sectionIndex}`;
									} else {
										messageKey = `pre_${nodeName}`;
									}

									if (
										!shownPreMessages.has(
											messageKey
										)
									) {
										// Check if this chunk already contains results (if it does, node already completed)
										// Only check chunk, not accumulated state, to allow showing message for new executions
										const hasResultsInChunk =
											stateUpdate
												.toolOutputs
												?.length >
												0 ||
											stateUpdate
												.keywordCandidates
												?.length >
												0 ||
											stateUpdate
												.titleCandidates
												?.length >
												0 ||
											stateUpdate
												.halt
												?.reason ===
												'await_keyword_selection' ||
											stateUpdate
												.halt
												?.reason ===
												'await_secondary_selection' ||
											stateUpdate
												.halt
												?.reason ===
												'await_title_selection';

										// Only show pre-message if this chunk doesn't already have results
										// This means the node just started executing, not completed
										if (
											!hasResultsInChunk
										) {
											let preMessage:
												| string
												| null =
												null;

											if (
												nodeName ===
												'research_primary'
											) {
												// Check if backend already sent this message to prevent duplicate
												const researchMsg =
													'🔍 **Researching primary keywords...**';
												const msgKey =
													researchMsg.substring(
														0,
														50
													);
												if (
													!backendMessages.has(
														msgKey
													)
												) {
													preMessage =
														"🔍 **Researching primary keywords...**\n\nI'm analyzing your topic to find the best primary keyword options for SEO optimization.";
												}
											} else if (
												nodeName ===
												'research_secondary'
											) {
												preMessage =
													"🔍 **Generating secondary keywords...**\n\nI'm finding related keywords that complement your primary keyword to expand your content's reach.";
											} else if (
												nodeName ===
												'title_generation'
											) {
												preMessage =
													"📝 **Generating title options...**\n\nI'm creating engaging title options that incorporate your keywords and appeal to your target audience.";
											} else if (
												nodeName ===
												'discovery'
											) {
												preMessage =
													"📋 **Generating outline...**\n\nI'm creating a comprehensive outline structure for your blog post.";
											} else if (
												nodeName ===
												'proposal'
											) {
												// When proposal node starts, sectionIndex is the section that will be generated (0-based)
												// So we show sectionIndex + 1 for user-friendly display
												const sectionIndex =
													accumulatedState
														.progress
														?.sectionIndex ??
													0;
												const sectionNumber =
													sectionIndex +
													1;

												// If this is the first section (sectionIndex === 0) and outline is approved, show starting message
												if (
													sectionIndex ===
														0 &&
													accumulatedState.outlineApproved &&
													accumulatedState.outline &&
													accumulatedState
														.outline
														.length >
														0
												) {
													preMessage =
														"✍️ **Starting blog generation...**\n\nI'll now create your blog post section by section, incorporating all your keywords and following the approved outline.";
												} else {
													preMessage = `✍️ **Writing section ${sectionNumber}...**\n\nI'm generating the content for this section.`;
												}
												
												// ✨ SIMPLE APPROACH: Keep isThinking true when blog generation starts
												// It will only be turned off when all sections are complete
												if (
													setIsThinking &&
													accumulatedState.outlineApproved &&
													accumulatedState.outline &&
													accumulatedState.outline.length > 0
												) {
													setIsThinking(true);
												}
											}

											if (
												preMessage
											) {
												shownPreMessages.add(
													messageKey
												);

												// Log when message is being queued
												console.log(
													`🚀 [PRE-MESSAGE] Queueing: "${preMessage}"`,
													{
														node: nodeName,
														messageKey,
														timestamp:
															new Date().toISOString(),
														chunkKeys:
															Object.keys(
																chunk
															),
														stateUpdateKeys:
															Object.keys(
																stateUpdate
															),
														hasResults:
															hasResultsInChunk,
													}
												);

												// Queue message to be displayed one at a time
												queueMessage(
													preMessage
												);
											}
										} else {
											// Mark as shown even if we don't show the message (to prevent duplicates)
											shownPreMessages.add(
												messageKey
											);
											console.log(
												`[PRE-MESSAGE] Skipped for ${nodeName}: Results already in chunk`,
												{
													messageKey,
													toolOutputs:
														stateUpdate
															.toolOutputs
															?.length,
													keywordCandidates:
														stateUpdate
															.keywordCandidates
															?.length,
													haltReason:
														stateUpdate
															.halt
															?.reason,
												}
											);
										}
									}
								}

								// Merge state update into accumulated state first
								// If trace exists, merge it properly (trace is usually appended, not replaced)
								const existingTrace =
									accumulatedState.trace ||
									[];
								if (
									stateUpdate.trace &&
									Array.isArray(
										stateUpdate.trace
									)
								) {
									// Merge traces - keep existing ones and add new ones
									const newTrace =
										stateUpdate.trace;
									// Combine and deduplicate by step and timestamp
									const combinedTrace = [
										...existingTrace,
									];
									for (const newEntry of newTrace) {
										const exists =
											combinedTrace.some(
												(
													existing
												) =>
													existing.step ===
														newEntry.step &&
													existing.at ===
														newEntry.at
											);
										if (!exists) {
											combinedTrace.push(
												newEntry
											);
										}
									}
									accumulatedState.trace =
										combinedTrace;
								}
								accumulatedState = {
									...accumulatedState,
									...stateUpdate,
									// Preserve merged trace
									trace:
										accumulatedState.trace ||
										existingTrace,
								};

								// ✨ Update draft in real-time if it exists in the state update
								// Use the merged accumulatedState to get the latest draft
								const latestDraft =
									accumulatedState.draft;
								if (
									latestDraft &&
									options?.setDraft
								) {
									// Map draft to V1 format if needed
									const draftValue =
										typeof latestDraft ===
										'string'
											? latestDraft
											: latestDraft;
									options.setDraft(
										draftValue
									);

									// Also update parent data if available
									if (options.updateData) {
										options.updateData({
											blogContent:
												draftValue,
										});
									}

									// Show progress message for section generation completion
									// Check if we have a trace entry indicating a section was just generated
									const latestTrace =
										accumulatedState
											.trace?.[
											accumulatedState
												.trace
												.length -
												1
										];
									if (
										latestTrace?.step ===
											'ProposalNode.generatedSection' &&
										accumulatedState
											.progress
											?.sectionIndex !==
											undefined
									) {
										// Trace has 0-based sectionIndex, progress has incremented (1-based) sectionIndex
										// Use progress.sectionIndex as it represents the completed section number
										const completedSectionNumber =
											accumulatedState
												.progress
												.sectionIndex;
										const sectionName =
											latestTrace
												.info
												?.section ||
											`Section ${completedSectionNumber}`;
										const completionMessage = `✅ Section ${completedSectionNumber} completed: "${sectionName}"`;

										// Only show message if this is a new section (not duplicate)
										if (
											completedSectionNumber >
											lastShownSectionIndex
										) {
											// Check if the "Writing section" message for this section is still streaming
											if (
												writingSectionNumber ===
												completedSectionNumber
											) {
												// "Writing section" message is still active for this section
												// Store the completion message to be queued after "Writing" finishes
												pendingCompletionMessages.set(
													completedSectionNumber,
													completionMessage
												);
												console.log(
													`⏳ [SECTION] Storing completion message for section ${completedSectionNumber}, waiting for "Writing" to finish`
												);
											} else {
												// "Writing section" message has finished or wasn't shown
												// Queue completion message immediately
												lastShownSectionIndex =
													completedSectionNumber;

												// ✨ SIMPLE APPROACH: Check if all sections are complete
												// Only turn off loader when ALL sections are done
												const currentSectionIndex =
													accumulatedState.progress?.sectionIndex ?? 0;
												const totalSections =
													accumulatedState.outline?.length ?? 0;
												const allSectionsComplete =
													accumulatedState.outlineApproved &&
													accumulatedState.outline &&
													totalSections > 0 &&
													currentSectionIndex >= totalSections;

												if (setIsThinking) {
													if (allSectionsComplete) {
														// All sections complete, turn off loader
														setIsThinking(false);
													} else {
														// Keep loader ON during blog generation
														setIsThinking(true);
													}
												}

												queueMessage(
													completionMessage
												);
											}
										}
									}
								}

								// ✨ Update agent state in real-time if available
								if (
									stateUpdate &&
									options?.setAgent
								) {
									const mappedState =
										mapBackendToV1(
											accumulatedState,
											currentState
										);
									options.setAgent(
										mappedState
									);
								}

								// ✨ Update outline in real-time if it exists
								if (
									stateUpdate.outline &&
									options?.setOutline
								) {
									options.setOutline(
										stateUpdate.outline
									);
								}

								// Check for trace-based progress messages
								// Use the accumulated state's trace to get the full trace array
								const currentTrace =
									accumulatedState.trace ||
									[];
								const currentTraceLength =
									currentTrace.length;

								if (
									shouldShowProgressMessage(
										currentTraceLength,
										lastTraceLength
									)
								) {
									// Process all new trace entries since last check
									const newTraces =
										currentTrace.slice(
											lastTraceLength
										);
									for (const traceEntry of newTraces) {
										if (traceEntry) {
											const stepMessage =
												getStepMessage(
													traceEntry.step,
													traceEntry.info
												);

											if (
												stepMessage
											) {
												console.log(
													`📨 [TRACE MESSAGE] Queueing: "${stepMessage}"`,
													{
														step: traceEntry.step,
														info: traceEntry.info,
														traceLength:
															currentTraceLength,
														lastTraceLength,
													}
												);
												// Queue step message
												queueMessage(
													stepMessage
												);
											}
										}
									}
									lastTraceLength =
										currentTraceLength;
								}

								// ✨ CRITICAL: Check for keyword candidates in progress event
								// This happens when research completes and keyword list is ready
								if (
									stateUpdate.keywordCandidates &&
									Array.isArray(
										stateUpdate.keywordCandidates
									) &&
									stateUpdate
										.keywordCandidates
										.length > 0
								) {
									// Determine if this is primary or secondary based on halt reason or current step
									const isPrimary =
										stateUpdate.halt
											?.reason ===
											'await_keyword_selection' ||
										nodeName ===
											'research_primary' ||
										accumulatedState.currentStep ===
											'primary_keyword';
									const isSecondary =
										stateUpdate.halt
											?.reason ===
											'await_secondary_selection' ||
										nodeName ===
											'research_secondary' ||
										accumulatedState.currentStep ===
											'secondary_keywords';

									// Check if we've already shown this keyword list
									const keywordListKey = `${
										isPrimary
											? 'primary'
											: 'secondary'
									}_keywords_${
										stateUpdate
											.keywordCandidates
											.length
									}`;
									if (
										!shownPreMessages.has(
											keywordListKey
										)
									) {
										shownPreMessages.add(
											keywordListKey
										);

										// Queue a message with keyword selection metadata
										// This will trigger the keyword selection UI component
										const keywordMessage =
											isPrimary
												? `🎯 **What main keyword should this article rank for?**\n\nSelect the primary keyword that best represents your target search term. This will be the main focus keyword for SEO optimization.`
												: `✨ **Secondary Keywords Ready!**\n\nI've found ${stateUpdate.keywordCandidates.length} secondary keywords that will help boost your SEO. Here they are:`;

										queueMessage(
											keywordMessage,
											{
												keywordSelection:
													{
														type: isPrimary
															? 'primary'
															: 'secondary',
														candidates:
															stateUpdate.keywordCandidates,
													},
											}
										);

										console.log(
											`📨 [PROGRESS] Keyword candidates detected and queued:`,
											{
												type: isPrimary
													? 'primary'
													: 'secondary',
												count: stateUpdate
													.keywordCandidates
													.length,
												haltReason:
													stateUpdate
														.halt
														?.reason,
											}
										);
									}
								}

								// Also check for other progress indicators
								// Only show progress messages if they're not already shown via trace messages
								let progressMsg = '';
								const hasTraceMessage =
									stateUpdate.trace &&
									Array.isArray(
										stateUpdate.trace
									) &&
									stateUpdate.trace.length >
										0;

								// Check for secondary keywords FIRST - must check this BEFORE primary keyword to avoid conflicts
								if (
									stateUpdate.data
										?.secondaryKeywords &&
									Array.isArray(
										stateUpdate.data
											.secondaryKeywords
									) &&
									stateUpdate.data
										.secondaryKeywords
										.length > 0
								) {
									// Check if this is a new addition (different from accumulated state)
									const isNew =
										!accumulatedState
											.data
											?.secondaryKeywords ||
										accumulatedState
											.data
											.secondaryKeywords
											.length !==
											stateUpdate
												.data
												.secondaryKeywords
												.length ||
										!arraysEqual(
											accumulatedState
												.data
												.secondaryKeywords,
											stateUpdate
												.data
												.secondaryKeywords
										);

									if (isNew) {
										// Show secondary keywords with full list
										const keywordsList =
											stateUpdate.data.secondaryKeywords.join(
												', '
											);
										progressMsg = `✅ Selected ${stateUpdate.data.secondaryKeywords.length} secondary keywords: ${keywordsList}`;
										console.log(
											`📨 [PROGRESS] Secondary keywords detected:`,
											{
												keywords: stateUpdate
													.data
													.secondaryKeywords,
												isNew,
												progressMsg,
											}
										);
									}
								} else if (
									stateUpdate.data?.title &&
									// Only show if title is newly added
									(!accumulatedState.data
										?.title ||
										accumulatedState
											.data
											.title !==
											stateUpdate
												.data
												.title)
								) {
									progressMsg = `📝 Generated title: "${stateUpdate.data.title}"`;
								} else if (
									stateUpdate.data
										?.primaryKeyword &&
									// Only show if primary keyword is newly added
									(!accumulatedState.data
										?.primaryKeyword ||
										accumulatedState
											.data
											.primaryKeyword !==
											stateUpdate
												.data
												.primaryKeyword) &&
									// Don't show if we're currently processing secondary keywords
									!(
										stateUpdate.data
											?.secondaryKeywords &&
										stateUpdate.data
											.secondaryKeywords
											.length > 0
									)
								) {
									progressMsg = `✅ Selected primary keyword: "${stateUpdate.data.primaryKeyword}"`;
								} else if (
									stateUpdate.outline &&
									!hasTraceMessage
								) {
									// Only show this if we don't have a trace message (to avoid duplicates)
									progressMsg = `📋 Generated outline with ${stateUpdate.outline.length} sections`;
								}

								if (progressMsg) {
									// Keep thinking indicator on during automation
									// Queue progress message
									queueMessage(progressMsg);
								}
							},
							onComplete: (data) => {
								if (hasResolved) return;
								hasResolved = true;
								setIsStreaming(false);

								// Map response back to V1 format
								// Remove apiKey from returned state if present
								const stateWithoutApiKey = {
									...data.state,
								};
								delete stateWithoutApiKey.apiKey;
								const updatedState =
									mapBackendToV1(
										stateWithoutApiKey,
										currentState
									);
								// Ensure apiKey is not in final state
								delete updatedState.apiKey;
								finalState = updatedState;

								// ✨ SIMPLE APPROACH: Only turn off loader when ALL sections are complete
								const currentSectionIndex =
									updatedState.progress?.sectionIndex ?? 0;
								const totalSections =
									updatedState.outline?.length ?? 0;
								const allSectionsComplete =
									updatedState.outlineApproved &&
									updatedState.outline &&
									totalSections > 0 &&
									currentSectionIndex >= totalSections;

								// Also keep it on if there's a halt (waiting for user input)
								const hasPendingSteps = updatedState.halt;

								if (setIsThinking) {
									if (allSectionsComplete && !hasPendingSteps) {
										// All sections complete and no pending steps, turn off loader
										setIsThinking(false);
									} else {
										// Keep loader ON during blog generation or if waiting for user input
										setIsThinking(true);
									}
								}

								console.log(
									'✅ Message processed:',
									{
										executed: data.executed,
										response:
											data.assistantMessage.substring(
												0,
												50
											) + '...',
									}
								);

								// Construct UI metadata based on state
								// First, check if backend provided metadata in response
								const backendMetadata =
									(data as any).metadata ||
									{};
								const metadata: Partial<ChatMessage> =
									{
										...backendMetadata, // Use backend metadata if available
									};

								// ✨ CRITICAL: Check if we already showed keyword list from progress event
								// If we did, don't show it again in done event to prevent duplicates
								const hasPrimaryKeywords =
									updatedState
										.keywordResearch
										?.primaryCandidates
										?.length > 0;
								const hasSecondaryKeywords =
									updatedState
										.keywordResearch
										?.secondaryCandidates
										?.length > 0;
								const primaryKeywordListKey =
									hasPrimaryKeywords
										? `primary_keywords_${updatedState.keywordResearch.primaryCandidates.length}`
										: null;
								const secondaryKeywordListKey =
									hasSecondaryKeywords
										? `secondary_keywords_${updatedState.keywordResearch.secondaryCandidates.length}`
										: null;
								const alreadyShownPrimary =
									primaryKeywordListKey &&
									shownPreMessages.has(
										primaryKeywordListKey
									);
								const alreadyShownSecondary =
									secondaryKeywordListKey &&
									shownPreMessages.has(
										secondaryKeywordListKey
									);

								// If no backend metadata, construct from state
								// BUT: Skip if we already showed it from progress event
								if (
									!backendMetadata.keywordSelection &&
									!backendMetadata.titleSelection &&
									!backendMetadata.outlineApproval
								) {
									if (updatedState.halt) {
										const reason =
											updatedState
												.halt
												.reason;

										if (
											reason ===
												'await_keyword_selection' &&
											!alreadyShownPrimary // Only add if not already shown
										) {
											metadata.keywordSelection =
												{
													type: 'primary',
													candidates:
														updatedState
															.keywordResearch
															?.primaryCandidates ||
														[],
												};
										} else if (
											reason ===
												'await_secondary_selection' &&
											!alreadyShownSecondary // Only add if not already shown
										) {
											metadata.keywordSelection =
												{
													type: 'secondary',
													candidates:
														updatedState
															.keywordResearch
															?.secondaryCandidates ||
														[],
												};
										} else if (
											reason ===
											'await_title_selection'
										) {
											metadata.titleSelection =
												{
													titles:
														updatedState.titleOptions ||
														[],
												};
										} else if (
											reason ===
												'await_interlinking' ||
											reason ===
												'await_interlinking_selection'
										) {
											metadata.interlinkingForm =
												{
													currentLinks:
														updatedState
															.data
															.interlinks ||
														[],
												};
										} else if (
											reason ===
												'await_references' ||
											reason ===
												'await_references_selection'
										) {
											metadata.referencesForm =
												{
													currentUrls:
														updatedState
															.data
															.referenceUrls ||
														[],
													currentFiles:
														updatedState
															.data
															.referenceFiles ||
														[],
												};
										} else if (
											reason ===
											'awaiting_approval'
										) {
											metadata.outlineApproval =
												{
													outline:
														updatedState.outline ||
														[],
												};
										}
									}
								} else {
									// Backend provided metadata, use it
									// Still check state for any additional metadata
									// ✨ CRITICAL: Check if we already showed keyword list from progress event
									const hasPrimaryKeywords =
										updatedState
											.keywordResearch
											?.primaryCandidates
											?.length > 0;
									const hasSecondaryKeywords =
										updatedState
											.keywordResearch
											?.secondaryCandidates
											?.length > 0;
									const primaryKeywordListKey =
										hasPrimaryKeywords
											? `primary_keywords_${updatedState.keywordResearch.primaryCandidates.length}`
											: null;
									const secondaryKeywordListKey =
										hasSecondaryKeywords
											? `secondary_keywords_${updatedState.keywordResearch.secondaryCandidates.length}`
											: null;
									const alreadyShownPrimary =
										primaryKeywordListKey &&
										shownPreMessages.has(
											primaryKeywordListKey
										);
									const alreadyShownSecondary =
										secondaryKeywordListKey &&
										shownPreMessages.has(
											secondaryKeywordListKey
										);

									if (updatedState.halt) {
										const reason =
											updatedState
												.halt
												.reason;
										// Only add metadata if not already provided by backend AND not already shown from progress
										if (
											!metadata.keywordSelection &&
											reason ===
												'await_keyword_selection' &&
											!alreadyShownPrimary
										) {
											metadata.keywordSelection =
												{
													type: 'primary',
													candidates:
														updatedState
															.keywordResearch
															?.primaryCandidates ||
														[],
												};
										} else if (
											!metadata.keywordSelection &&
											reason ===
												'await_secondary_selection' &&
											!alreadyShownSecondary
										) {
											metadata.keywordSelection =
												{
													type: 'secondary',
													candidates:
														updatedState
															.keywordResearch
															?.secondaryCandidates ||
														[],
												};
										} else if (
											!metadata.titleSelection &&
											reason ===
												'await_title_selection'
										) {
											metadata.titleSelection =
												{
													titles:
														updatedState.titleOptions ||
														[],
												};
										} else if (
											!metadata.outlineApproval &&
											reason ===
												'awaiting_approval'
										) {
											metadata.outlineApproval =
												{
													outline:
														updatedState.outline ||
														[],
												};
										}
									}
								}

								// Track if we queued a message with metadata to prevent duplicates
								let messageWithMetadataQueued =
									false;

								// ✨ CRITICAL: If keyword list was already shown from progress event,
								// don't include it in metadata to prevent duplicates
								if (metadata.keywordSelection) {
									const keywordType =
										metadata
											.keywordSelection
											.type;
									const keywordCount =
										metadata
											.keywordSelection
											.candidates
											?.length || 0;
									const keywordListKey = `${keywordType}_keywords_${keywordCount}`;
									if (
										shownPreMessages.has(
											keywordListKey
										)
									) {
										// Already shown from progress event, remove from metadata to prevent duplicate
										console.log(
											`📨 [DONE] Skipping keyword metadata (already shown from progress): ${keywordListKey}`
										);
										delete metadata.keywordSelection;
									}
								}

								// Queue final response if it exists and wasn't already queued
								// If we queue it, clear finalResponse so AgentMode won't add it again
								if (
									finalResponse &&
									finalResponse.trim()
								) {
									queueMessage(
										finalResponse,
										metadata
									);
									finalResponse = ''; // Clear to prevent duplicate in AgentMode
									messageWithMetadataQueued =
										true;
								}

								// Wait for queue to finish processing before resolving
								waitForQueueToComplete(() => {
									resolve({
										response: '', // Empty since we queued it
										updatedState,
										// Only return metadata if we didn't already queue a message with it
										// This prevents AgentMode from adding a duplicate message
										metadata: messageWithMetadataQueued
											? undefined
											: metadata,
									});
								});
							},
							onError: (error) => {
								if (hasResolved) return;
								hasResolved = true;
								setIsStreaming(false);
								if (setIsThinking)
									setIsThinking(false);

								// Check if it's a rate limit error
								const errorMessage =
									error.message ||
									'An error occurred';
								const isRateLimit =
									/rate limit|quota|429/i.test(
										errorMessage
									);

								if (isRateLimit) {
									// Queue user-friendly rate limit message
									queueMessage(
										`⚠️ **Rate Limit Exceeded**\n\n${errorMessage}\n\nThe system will automatically retry. Please wait a moment.`
									);
								} else {
									// Queue general error message
									queueMessage(
										`❌ **Error**\n\n${errorMessage}`
									);
								}

								console.error(
									'Stream Error:',
									error
								);
								reject(error);
							},
						},
						abortController // Pass abort controller for cancellation
					);
				});
			} catch (error) {
				setIsStreaming(false);
				if (setIsThinking) setIsThinking(false);
				console.error('V3 Message Error:', error);
				throw error;
			}
		},
		[]
	);

	// Cleanup: Cancel any ongoing streams when component unmounts
	useEffect(() => {
		return () => {
			if (abortControllerRef.current) {
				console.log(
					'🧹 Cleaning up: Cancelling ongoing stream'
				);
				abortControllerRef.current.abort();
				abortControllerRef.current = null;
			}
		};
	}, []);

	// Backward compatible wrapper for AgentMode
	const runAgentLoop = useCallback(
		async (
			working: AgentStateV1,
			maxIterations: number,
			onProgress?: (working: AgentStateV1) => void,
			onStateUpdate?: (working: AgentStateV1) => void
		): Promise<AgentStateV1> => {
			// V3 doesn't use iterations - it's message-based
			// This is just a compatibility shim
			// The actual execution happens via sendUserMessage in handleSend

			if (onStateUpdate) {
				onStateUpdate(working);
			}

			return working;
		},
		[]
	);

	return { sendUserMessage, runAgentLoop };
};
