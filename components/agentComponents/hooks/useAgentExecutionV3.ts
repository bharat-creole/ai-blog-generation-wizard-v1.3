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

							// ✨ NEW: If multiple messages are provided, add them separately
							// This allows separate messages for different steps (e.g., "Got it! I've captured..." + "Let me research keywords...")
							if (data.assistantMessages && Array.isArray(data.assistantMessages) && data.assistantMessages.length > 1) {
								console.log(`📨 [INTENT] Adding ${data.assistantMessages.length} separate messages:`, data.assistantMessages);
								// Add each message separately with a small delay for better UX
								data.assistantMessages.forEach((msg, index) => {
									setTimeout(() => {
										setMessages((prev) => {
											const newMessages = [
												...prev,
												{
													role: 'assistant',
													content: msg,
												},
											];
											console.log(`✅ [INTENT] Added message ${index + 1}/${data.assistantMessages.length}: "${msg}"`, {
												totalMessages: newMessages.length,
												timestamp: new Date().toISOString()
											});
											return newMessages;
										});
									}, index * 150); // 150ms delay between messages for better readability
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
							if (nodeName && !shownPreMessages.has(`pre_${nodeName}`)) {
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
										const sectionIndex = accumulatedState.progress?.sectionIndex || 0;
										preMessage = `✍️ Writing section ${sectionIndex + 1}...`;
									}

									if (preMessage) {
										shownPreMessages.add(`pre_${nodeName}`);
										if (setIsThinking) setIsThinking(false);
										
										// Log when message is being sent to frontend
										console.log(`🚀 [PRE-MESSAGE] Sending to frontend: "${preMessage}"`, {
											node: nodeName,
											timestamp: new Date().toISOString(),
											chunkKeys: Object.keys(chunk),
											stateUpdateKeys: Object.keys(stateUpdate),
											hasResults: hasResultsInChunk
										});
										
										// Add message to state (this triggers UI update)
										setMessages((prev) => {
											const newMessages = [
												...prev,
												{
													role: 'assistant',
													content: preMessage,
												},
											];
											
											// Log when message is added to state
											console.log(`✅ [PRE-MESSAGE] Added to messages state: "${preMessage}"`, {
												totalMessages: newMessages.length,
												lastMessage: newMessages[newMessages.length - 1],
												timestamp: new Date().toISOString()
											});
											
											return newMessages;
										});
										
										// Log confirmation
										console.log(`📺 [PRE-MESSAGE] Should now be displayed in UI: "${preMessage}"`);
									}
								} else {
									// Mark as shown even if we don't show the message (to prevent duplicates)
									shownPreMessages.add(`pre_${nodeName}`);
									console.log(`[PRE-MESSAGE] Skipped for ${nodeName}: Results already in chunk`, {
										toolOutputs: stateUpdate.toolOutputs?.length,
										keywordCandidates: stateUpdate.keywordCandidates?.length,
										haltReason: stateUpdate.halt?.reason
									});
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

								// Show progress message for section generation
								if (accumulatedState.progress?.sectionIndex !== undefined) {
									const sectionIndex = accumulatedState.progress.sectionIndex;
									const latestTrace = accumulatedState.trace?.[accumulatedState.trace.length - 1];
									const sectionName = latestTrace?.info?.section || `Section ${sectionIndex}`;
									
									// Only show message if this is a new section (not duplicate)
									if (sectionIndex > lastShownSectionIndex) {
										// Update the last shown section index
										lastShownSectionIndex = sectionIndex;
										
										if (setIsThinking) setIsThinking(false);
										
										// Show completion message in chat
										setMessages((prev) => [
											...prev,
											{
												role: 'assistant',
												content: `✅ Section - ${sectionIndex} completed: "${sectionName}"`,
											},
										]);
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

										setMessages(
											(prev) => [
												...prev,
												createAssistantMessage(
													stepMessage
												),
											]
										);
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
								setMessages((prev) => [
									...prev,
									{
										role: 'assistant',
										content: progressMsg,
									},
								]);
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

							// Use finalResponse (which may be empty if separate messages were already added)
							// instead of data.assistantMessage to prevent duplicates
							resolve({
								response: finalResponse, // Use finalResponse instead of data.assistantMessage
								updatedState,
								metadata,
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
								// Show user-friendly rate limit message
								setMessages((prev) => [
									...prev,
									{
										role: 'assistant',
										content: `⚠️ **Rate Limit Exceeded**\n\n${errorMessage}\n\nThe system will automatically retry. Please wait a moment.`,
									},
								]);
							} else {
								// Show general error message
								setMessages((prev) => [
									...prev,
									{
										role: 'assistant',
										content: `❌ **Error**\n\n${errorMessage}`,
									},
								]);
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
