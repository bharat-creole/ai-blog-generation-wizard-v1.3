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
 * Convert V1 state to backend-compatible format
 */
const mapV1ToBackend = (v1: AgentStateV1): any => {
	return {
		messages: v1.messages.map((m) => ({
			role: m.role,
			content: m.content,
		})),
		data: v1.data,
		apiKey: v1.apiKey,
		outline: v1.outline,
		outlineApproved: v1.outlineApproved,
		draft: v1.draft,
		progress: v1.progress,
		preferences: v1.preferences,
		trace: v1.trace,
		halt: v1.halt || null,
		userProvidedFields: Array.from(v1.userProvidedFields || []),
		autoFillFields: Array.from(v1.autoFillFields || []),
		// ✨ Map new V2 fields
		currentStep: v1.currentStep,
		toolOutputs: v1.toolOutputs,
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
	// Direct message sending (new API)
	const sendUserMessage = useCallback(
		async (
			message: string,
			currentState: AgentStateV1
		): Promise<{
			response: string;
			updatedState: AgentStateV1;
			metadata?: Partial<ChatMessage>;
		}> => {
			const backendState = mapV1ToBackend(currentState);
			const threadId = `thread-${Date.now()}`; // Generate unique thread ID per session

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

					streamMessage(message, threadId, backendState, {
						onIntent: (data) => {
							// Initial assistant response (e.g. "I'll handle that...")
							finalResponse = data.assistantMessage;

							// Don't add message here - it will be added in AgentMode.tsx with metadata
							// This prevents duplicate messages
						},
						onProgress: (chunk) => {
							// Extract state from chunk (chunk is usually { nodeName: { ...state } })
							const nodeName =
								Object.keys(chunk)[0];
							const stateUpdate = nodeName
								? chunk[nodeName]
								: chunk;

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
							const updatedState = mapBackendToV1(
								data.state,
								currentState
							);
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

							resolve({
								response: data.assistantMessage,
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
