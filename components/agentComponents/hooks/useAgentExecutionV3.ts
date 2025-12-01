import { useState, useCallback, useRef } from 'react';
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
		const key = `${item.type}-${item.timestamp}-${JSON.stringify(item.data)}`;
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
			const envApiKey = import.meta.env?.VITE_GEMINI_API_KEY || import.meta.env?.GEMINI_API_KEY;
			
			// Extract apiKey from parameter, state, or environment variable (in that order)
			const apiKeyToUse = apiKey || currentState?.apiKey || envApiKey;
			if (!apiKeyToUse) {
				throw new Error('apiKey is required. Please provide apiKey as a parameter, in state, or set VITE_GEMINI_API_KEY in your .env.local file.');
			}
			// Remove apiKey from state before mapping
			const stateWithoutApiKey = { ...currentState };
			delete stateWithoutApiKey.apiKey;
			const backendState = mapV1ToBackend(stateWithoutApiKey, apiKeyToUse);
			// Use existing threadId or create a new one for the session
			if (!threadIdRef.current) {
				threadIdRef.current = `thread-${Date.now()}`;
			}
			const threadId = threadIdRef.current;

			setIsStreaming(true);
			if (setIsThinking) setIsThinking(true);

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
					let pendingCompletionMessages: Map<number, string> = new Map(); // Store completion messages waiting for "Writing" to finish

					// ✨ Message queue system - ensures messages are displayed one at a time
					// Messages wait for the previous message to finish streaming before displaying
					const messageQueue: Array<{ 
						content: string; 
						metadata?: any;
						onStreamingComplete?: () => void;
					}> = [];
					let isProcessingQueue = false;
					let currentMessageStreaming = false;
					let currentMessageCompleteCallback: (() => void) | null = null;

					const processMessageQueue = () => {
						// Don't process if already processing or queue is empty
						if (isProcessingQueue || messageQueue.length === 0) {
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
							const isWritingSectionMessage = message.content.includes('✍️ Writing section');
							const pauseAfterStreaming = isWritingSectionMessage ? 800 : 0; // 800ms pause after "Writing section" messages
							
							// Extract section number from "Writing section X..." message
							if (isWritingSectionMessage) {
								const match = message.content.match(/Writing section (\d+)/);
								if (match) {
									writingSectionNumber = parseInt(match[1], 10);
								}
							}
							
							const messageMetadata = {
								...(message.metadata || {}),
								_streamingCompleteCallback: () => {
									// Add pause after "Writing section" messages complete
									if (pauseAfterStreaming > 0 && writingSectionNumber !== null) {
										setTimeout(() => {
											// Check if there's a pending completion message for this section
											const pendingMessage = pendingCompletionMessages.get(writingSectionNumber!);
											if (pendingMessage) {
												pendingCompletionMessages.delete(writingSectionNumber!);
												// Keep thinking indicator on until completion message is displayed
												// It will be turned off when completion message is queued
												queueMessage(pendingMessage);
											}
											// Note: Keep thinking indicator on if no completion message yet
											// It will be turned off when completion message arrives
											
											writingSectionNumber = null;
											currentMessageStreaming = false;
											currentMessageCompleteCallback = null;
											isProcessingQueue = false;
											// Process next message after pause
											processMessageQueue();
										}, pauseAfterStreaming);
									} else {
										currentMessageStreaming = false;
										currentMessageCompleteCallback = null;
										isProcessingQueue = false;
										// Process next message after current one completes streaming
										processMessageQueue();
									}
								},
								_messageId: messageId,
							};
							
							// Store callback for this message
							currentMessageCompleteCallback = messageMetadata._streamingCompleteCallback;
							
							setMessages((prev) => {
								const newMessages = [
									...prev,
									{
										role: 'assistant',
										content: message.content,
										...messageMetadata,
									},
								];
								return newMessages;
							});
						} else {
							isProcessingQueue = false;
						}
					};

					const queueMessage = (content: string, metadata?: any) => {
						messageQueue.push({ content, metadata });
						processMessageQueue();
					};

					const waitForQueueToComplete = (callback: () => void) => {
						const checkQueue = () => {
							// Wait until queue is empty AND no message is currently streaming
							if (messageQueue.length === 0 && !isProcessingQueue && !currentMessageStreaming) {
								callback();
							} else {
								setTimeout(checkQueue, 100);
							}
						};
						checkQueue();
					};

					// Helper to get pre-execution message based on current step
					const getPreExecutionMessage = (state: any): string | null => {
						const currentStep = state.currentStep;
						const haltReason = state.halt?.reason;

						// Check if we're about to execute a node
						if (haltReason) return null; // Don't show if halted

						// Determine which node will execute next based on currentStep
						if (currentStep === 'topic' && !state.data?.primaryKeyword) {
							return '🔍 Generating primary keywords...';
						}
						if (currentStep === 'primary_keyword' && !state.data?.primaryKeyword) {
							return '🔍 Generating primary keywords...';
						}
						if (currentStep === 'secondary_keywords' && (!state.data?.secondaryKeywords || state.data.secondaryKeywords.length === 0)) {
							return '🔍 Generating secondary keywords...';
						}
						if (currentStep === 'title' && !state.data?.title) {
							return '📝 Generating title options...';
						}
						if (currentStep === 'outline' && (!state.outline || state.outline.length === 0)) {
							return '📋 Generating outline...';
						}
						if (currentStep === 'generation' && state.outlineApproved) {
							const sectionIndex = state.progress?.sectionIndex || 0;
							if (sectionIndex < (state.outline?.length || 0)) {
								return `✍️ Writing section ${sectionIndex + 1}...`;
							}
						}

						return null;
					};

					streamMessage(message, threadId, backendState, apiKeyToUse, {
						onIntent: (data) => {
							// Initial assistant response (e.g. "I'll handle that...")
							finalResponse = data.assistantMessage;

							// ✨ NEW: If multiple messages are provided, queue them one at a time
							// This allows separate messages for different steps (e.g., "Got it! I've captured..." + "Let me research keywords...")
							if (data.assistantMessages && Array.isArray(data.assistantMessages) && data.assistantMessages.length > 1) {
								console.log(`📨 [INTENT] Queueing ${data.assistantMessages.length} separate messages:`, data.assistantMessages);
								// Queue each message to be displayed one at a time
								data.assistantMessages.forEach((msg) => {
									queueMessage(msg);
								});
								// Mark that messages were already added, so AgentMode.tsx won't add the single message
								finalResponse = ''; // Clear finalResponse to prevent duplicate
							}
							// If single message, don't add here - it will be added in AgentMode.tsx with metadata
							// This prevents duplicate messages
						},
						onProgress: (chunk) => {
							// Debug: Log chunk structure
							console.log('[PROGRESS CHUNK]', {
								chunkKeys: Object.keys(chunk),
								chunkStructure: chunk
							});

							// Extract state from chunk (chunk is usually { nodeName: { ...state } })
							const nodeName = Object.keys(chunk)[0];
							const stateUpdate = nodeName
								? chunk[nodeName]
								: chunk;

							console.log('[PROGRESS] Node detected:', nodeName, {
								hasStateUpdate: !!stateUpdate,
								stateUpdateKeys: stateUpdate ? Object.keys(stateUpdate) : []
							});

							// Show pre-execution message when we first detect a node is executing
							// Show it immediately when we see the node name, before merging state
							// For proposal node, track per section to show message for each section
							if (nodeName) {
								// For proposal node, use section-specific key to show message for each section
								let messageKey: string;
								if (nodeName === 'proposal') {
									const sectionIndex = accumulatedState.progress?.sectionIndex ?? 0;
									messageKey = `pre_${nodeName}_${sectionIndex}`;
								} else {
									messageKey = `pre_${nodeName}`;
								}

								if (!shownPreMessages.has(messageKey)) {
									// Check if this chunk already contains results (if it does, node already completed)
									// Only check chunk, not accumulated state, to allow showing message for new executions
									const hasResultsInChunk = 
										stateUpdate.toolOutputs?.length > 0 ||
										stateUpdate.keywordCandidates?.length > 0 ||
										stateUpdate.titleCandidates?.length > 0 ||
										stateUpdate.halt?.reason === 'await_keyword_selection' ||
										stateUpdate.halt?.reason === 'await_secondary_selection' ||
										stateUpdate.halt?.reason === 'await_title_selection';

									// Only show pre-message if this chunk doesn't already have results
									// This means the node just started executing, not completed
									if (!hasResultsInChunk) {
										let preMessage: string | null = null;
										
										if (nodeName === 'research_primary') {
											preMessage = '🔍 Generating primary keywords...';
										} else if (nodeName === 'research_secondary') {
											preMessage = '🔍 Generating secondary keywords...';
										} else if (nodeName === 'title_generation') {
											preMessage = '📝 Generating title options...';
										} else if (nodeName === 'discovery') {
											preMessage = '📋 Generating outline...';
									} else if (nodeName === 'proposal') {
										// When proposal node starts, sectionIndex is the section that will be generated (0-based)
										// So we show sectionIndex + 1 for user-friendly display
										const sectionIndex = accumulatedState.progress?.sectionIndex ?? 0;
										const sectionNumber = sectionIndex + 1;
										preMessage = `✍️ Writing section ${sectionNumber}...`;
									}

									if (preMessage) {
										shownPreMessages.add(messageKey);
										// For proposal node, keep thinking indicator on while generating
										if (nodeName === 'proposal') {
											if (setIsThinking) setIsThinking(true);
										} else {
											if (setIsThinking) setIsThinking(false);
										}
											
											// Log when message is being queued
											console.log(`🚀 [PRE-MESSAGE] Queueing: "${preMessage}"`, {
												node: nodeName,
												messageKey,
												timestamp: new Date().toISOString(),
												chunkKeys: Object.keys(chunk),
												stateUpdateKeys: Object.keys(stateUpdate),
												hasResults: hasResultsInChunk
											});
											
											// Queue message to be displayed one at a time
											queueMessage(preMessage);
										}
									} else {
										// Mark as shown even if we don't show the message (to prevent duplicates)
										shownPreMessages.add(messageKey);
										console.log(`[PRE-MESSAGE] Skipped for ${nodeName}: Results already in chunk`, {
											messageKey,
											toolOutputs: stateUpdate.toolOutputs?.length,
											keywordCandidates: stateUpdate.keywordCandidates?.length,
											haltReason: stateUpdate.halt?.reason
										});
									}
								}
							}

							// Merge state update into accumulated state first
							// If trace exists, it might be appended, so we need to check the full trace
							if (
								stateUpdate.trace &&
								Array.isArray(stateUpdate.trace)
							) {
								accumulatedState.trace =
									stateUpdate.trace;
							}
							accumulatedState = {
								...accumulatedState,
								...stateUpdate,
							};

							// ✨ Update draft in real-time if it exists in the state update
							// Use the merged accumulatedState to get the latest draft
							const latestDraft = accumulatedState.draft;
							if (latestDraft && options?.setDraft) {
								// Map draft to V1 format if needed
								const draftValue = typeof latestDraft === 'string' 
									? latestDraft 
									: latestDraft;
								options.setDraft(draftValue);
								
								// Also update parent data if available
								if (options.updateData) {
									options.updateData({ blogContent: draftValue });
								}

								// Show progress message for section generation completion
								// Check if we have a trace entry indicating a section was just generated
								const latestTrace = accumulatedState.trace?.[accumulatedState.trace.length - 1];
								if (
									latestTrace?.step === 'ProposalNode.generatedSection' &&
									accumulatedState.progress?.sectionIndex !== undefined
								) {
									// Trace has 0-based sectionIndex, progress has incremented (1-based) sectionIndex
									// Use progress.sectionIndex as it represents the completed section number
									const completedSectionNumber = accumulatedState.progress.sectionIndex;
									const sectionName = latestTrace.info?.section || `Section ${completedSectionNumber}`;
									const completionMessage = `✅ Section ${completedSectionNumber} completed: "${sectionName}"`;
									
									// Only show message if this is a new section (not duplicate)
									if (completedSectionNumber > lastShownSectionIndex) {
										// Check if the "Writing section" message for this section is still streaming
										if (writingSectionNumber === completedSectionNumber) {
											// "Writing section" message is still active for this section
											// Store the completion message to be queued after "Writing" finishes
											pendingCompletionMessages.set(completedSectionNumber, completionMessage);
											console.log(`⏳ [SECTION] Storing completion message for section ${completedSectionNumber}, waiting for "Writing" to finish`);
										} else {
											// "Writing section" message has finished or wasn't shown
											// Queue completion message immediately
											lastShownSectionIndex = completedSectionNumber;
											// Turn off thinking indicator when section completes
											if (setIsThinking) setIsThinking(false);
											queueMessage(completionMessage);
										}
									}
								}
							}

							// ✨ Update agent state in real-time if available
							if (stateUpdate && options?.setAgent) {
								const mappedState = mapBackendToV1(
									accumulatedState,
									currentState
								);
								options.setAgent(mappedState);
							}

							// ✨ Update outline in real-time if it exists
							if (stateUpdate.outline && options?.setOutline) {
								options.setOutline(stateUpdate.outline);
							}

							// Check for trace-based progress messages
							// Use the accumulated state's trace to get the full trace array
							const currentTrace =
								accumulatedState.trace || [];
							const currentTraceLength =
								currentTrace.length;

							if (
								shouldShowProgressMessage(
									currentTraceLength,
									lastTraceLength
								)
							) {
								const latestTrace =
									currentTrace[
										currentTrace.length -
											1
									];
								if (latestTrace) {
									const stepMessage =
										getStepMessage(
											latestTrace.step,
											latestTrace.info
										);

									if (stepMessage) {
										// Turn off thinking indicator as soon as we start showing progress
										if (setIsThinking)
											setIsThinking(
												false
											);

										// Queue step message
										queueMessage(stepMessage);
									}
								}
								lastTraceLength =
									currentTraceLength;
							}

							// Also check for other progress indicators
							let progressMsg = '';

							if (chunk.keywordResearch) {
								const candidates =
									chunk.keywordResearch
										.primaryCandidates ||
									chunk.keywordResearch
										.secondaryCandidates;
								if (candidates?.length) {
									progressMsg = `🔍 Found ${candidates.length} keywords...`;
								}
							} else if (stateUpdate.data?.title) {
								progressMsg = `📝 Generated title: "${stateUpdate.data.title}"`;
							} else if (
								stateUpdate.data?.primaryKeyword
							) {
								progressMsg = `✅ Selected primary keyword: "${stateUpdate.data.primaryKeyword}"`;
							} else if (
								stateUpdate.data
									?.secondaryKeywords
							) {
								progressMsg = `✅ Selected ${stateUpdate.data.secondaryKeywords.length} secondary keywords`;
							} else if (
								stateUpdate.outline &&
								!stateUpdate.trace
							) {
								// Only show this if we don't have a trace message (to avoid duplicates)
								progressMsg = `📋 Generated outline with ${stateUpdate.outline.length} sections`;
							}

							if (progressMsg) {
								if (setIsThinking)
									setIsThinking(false);
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
							const stateWithoutApiKey = { ...data.state };
							delete stateWithoutApiKey.apiKey;
							const updatedState = mapBackendToV1(
								stateWithoutApiKey,
								currentState
							);
							// Ensure apiKey is not in final state
							delete updatedState.apiKey;
							finalState = updatedState;

							console.log('✅ Message processed:', {
								executed: data.executed,
								response:
									data.assistantMessage.substring(
										0,
										50
									) + '...',
							});

							// Construct UI metadata based on state
							const metadata: Partial<ChatMessage> =
								{};

							if (updatedState.halt) {
								const reason =
									updatedState.halt.reason;

								if (
									reason ===
									'await_keyword_selection'
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
									'await_secondary_selection'
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

							// Queue final response if it exists and wasn't already queued
							// If we queue it, clear finalResponse so AgentMode won't add it again
							if (finalResponse && finalResponse.trim()) {
								queueMessage(finalResponse, metadata);
								finalResponse = ''; // Clear to prevent duplicate in AgentMode
							}

							// Wait for queue to finish processing before resolving
							waitForQueueToComplete(() => {
								resolve({
									response: '', // Empty since we queued it
									updatedState,
									metadata,
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
								queueMessage(`⚠️ **Rate Limit Exceeded**\n\n${errorMessage}\n\nThe system will automatically retry. Please wait a moment.`);
							} else {
								// Queue general error message
								queueMessage(`❌ **Error**\n\n${errorMessage}`);
							}

							console.error('Stream Error:', error);
							reject(error);
						},
					});
				});
			} catch (error) {
				setIsStreaming(false);
				console.error('V3 Message Error:', error);
				throw error;
			}
		},
		[]
	);

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
