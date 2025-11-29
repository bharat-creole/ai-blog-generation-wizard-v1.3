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
    ) => Promise<{ response: string; updatedState: AgentStateV1; metadata?: Partial<ChatMessage> }>;
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
        messages: v1.messages.map(m => ({
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
const mapBackendToV1 = (backend: any, originalV1: AgentStateV1): AgentStateV1 => {
    return {
        ...originalV1,
        data: backend.data || originalV1.data,
        outline: backend.outline || originalV1.outline,
        outlineApproved: backend.outlineApproved ?? originalV1.outlineApproved,
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
            primaryCandidates: !backend.data?.primaryKeyword ? backend.keywordCandidates : originalV1.keywordResearch?.primaryCandidates,
            secondaryCandidates: backend.data?.primaryKeyword ? backend.keywordCandidates : originalV1.keywordResearch?.secondaryCandidates,
        },
        titleOptions: backend.titleCandidates || originalV1.titleOptions,
        // ✨ Map new V2 fields
        currentStep: backend.currentStep,
        toolOutputs: backend.toolOutputs,
    };
};

export const useAgentExecutionV3 = (
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
    setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>,
    setIsThinking?: React.Dispatch<React.SetStateAction<boolean>>
): UseAgentExecutionReturn => {

    // Direct message sending (new API)
    const sendUserMessage = useCallback(async (
        message: string,
        currentState: AgentStateV1
    ): Promise<{ response: string; updatedState: AgentStateV1; metadata?: Partial<ChatMessage> }> => {

        const backendState = mapV1ToBackend(currentState);
        const threadId = `thread-${Date.now()}`; // Generate unique thread ID per session

        setIsStreaming(true);
        if (setIsThinking) setIsThinking(true);

        try {
            return new Promise((resolve, reject) => {
                let finalState: any = null;
                let finalResponse = '';
                let hasResolved = false;
                let messageAdded = false; // Track if message has been added to prevent duplicates
                let lastTraceLength = currentState.trace?.length || 0;
                let accumulatedState: any = { ...currentState };

                streamMessage(
                    message,
                    threadId,
                    backendState,
                    {
                        onIntent: (data) => {
                            // Store the initial assistant response
                            // Don't add to messages here - wait for onComplete to add with metadata
                            finalResponse = data.assistantMessage;
                        },
                        onProgress: (chunk) => {
                            // Extract state from chunk (chunk is usually { nodeName: { ...state } })
                            const nodeName = Object.keys(chunk)[0];
                            const stateUpdate = nodeName ? chunk[nodeName] : chunk;
                            
                            // Merge state update into accumulated state
                            // If trace exists, it might be appended, so we need to check the full trace
                            if (stateUpdate.trace && Array.isArray(stateUpdate.trace)) {
                                accumulatedState.trace = stateUpdate.trace;
                            }
                            accumulatedState = { ...accumulatedState, ...stateUpdate };
                            
                            // Check for trace-based progress messages
                            // Use the accumulated state's trace to get the full trace array
                            const currentTrace = accumulatedState.trace || [];
                            const currentTraceLength = currentTrace.length;
                            
                            if (shouldShowProgressMessage(currentTraceLength, lastTraceLength)) {
                                const latestTrace = currentTrace[currentTrace.length - 1];
                                if (latestTrace) {
                                    const stepMessage = getStepMessage(latestTrace.step, latestTrace.info);
                                    
                                    if (stepMessage) {
                                        // Turn off thinking indicator as soon as we start showing progress
                                        if (setIsThinking) setIsThinking(false);
                                        
                                        setMessages(prev => [
                                            ...prev,
                                            createAssistantMessage(stepMessage)
                                        ]);
                                    }
                                }
                                lastTraceLength = currentTraceLength;
                            }
                            
                            // Also check for other progress indicators
                            let progressMsg = '';

                            if (chunk.keywordResearch) {
                                const candidates = chunk.keywordResearch.primaryCandidates || chunk.keywordResearch.secondaryCandidates;
                                if (candidates?.length) {
                                    progressMsg = `🔍 Found ${candidates.length} keywords...`;
                                }
                            } else if (stateUpdate.data?.title) {
                                progressMsg = `📝 Generated title: "${stateUpdate.data.title}"`;
                            } else if (stateUpdate.data?.primaryKeyword) {
                                progressMsg = `✅ Selected primary keyword: "${stateUpdate.data.primaryKeyword}"`;
                            } else if (stateUpdate.data?.secondaryKeywords) {
                                progressMsg = `✅ Selected ${stateUpdate.data.secondaryKeywords.length} secondary keywords`;
                            } else if (stateUpdate.outline && !stateUpdate.trace) {
                                // Only show this if we don't have a trace message (to avoid duplicates)
                                progressMsg = `📋 Generated outline with ${stateUpdate.outline.length} sections`;
                            }

                            if (progressMsg) {
                                if (setIsThinking) setIsThinking(false);
                                setMessages(prev => [
                                    ...prev,
                                    { role: 'assistant', content: progressMsg }
                                ]);
                            }
                        },
                        onComplete: (data) => {
                            if (hasResolved) return;
                            hasResolved = true;
                            setIsStreaming(false);

                            // Map response back to V1 format
                            const updatedState = mapBackendToV1(data.state, currentState);
                            finalState = updatedState;

                            console.log('✅ Message processed:', {
                                executed: data.executed,
                                response: data.assistantMessage.substring(0, 50) + '...'
                            });

                            // Construct UI metadata based on state
                            const metadata: Partial<ChatMessage> = {};
                            let enhancedMessage = data.assistantMessage;

                            if (updatedState.halt) {
                                const reason = updatedState.halt.reason;

                                if (reason === 'await_keyword_selection') {
                                    metadata.keywordSelection = {
                                        type: 'primary',
                                        candidates: updatedState.keywordResearch?.primaryCandidates || []
                                    };
                                    // Enhance message with guidance if not already present
                                    if (!enhancedMessage.includes('select') && !enhancedMessage.includes('Tip')) {
                                        enhancedMessage = `🎯 **Primary Keyword Selection**\n\nPlease select a primary keyword from the options below, or if you would like to add your own, simply type it in the chat!`;
                                    }
                                } else if (reason === 'await_secondary_selection') {
                                    metadata.keywordSelection = {
                                        type: 'secondary',
                                        candidates: updatedState.keywordResearch?.secondaryCandidates || []
                                    };
                                    // Enhance message with guidance if not already present
                                    if (!enhancedMessage.includes('select') && !enhancedMessage.includes('Tip')) {
                                        enhancedMessage = `🎯 **Secondary Keywords Selection**\n\nPlease select up to 5 secondary keywords from the options below, or if you would like to add your own, simply type them in the chat (comma-separated)!`;
                                    }
                                } else if (reason === 'await_title_selection') {
                                    metadata.titleSelection = {
                                        titles: updatedState.titleOptions || []
                                    };
                                    // Enhance message with guidance if not already present
                                    if (!enhancedMessage.includes('select') && !enhancedMessage.includes('Tip')) {
                                        enhancedMessage = `📝 **Title Selection**\n\nPlease select a blog title from the options below, or if you would like to add your own, simply type it in the chat!`;
                                    }
                                } else if (reason === 'await_interlinking' || reason === 'await_interlinking_selection') {
                                    metadata.interlinkingForm = {
                                        currentLinks: updatedState.data.interlinks || []
                                    };
                                    // Enhance message with guidance if not already present
                                    if (!enhancedMessage.includes('add') && !enhancedMessage.includes('optional')) {
                                        enhancedMessage = `🔗 **Internal Links**\n\nPlease add any internal links to your existing content (optional), or click "Continue" to skip this step.`;
                                    }
                                } else if (reason === 'await_references' || reason === 'await_references_selection') {
                                    metadata.referencesForm = {
                                        currentUrls: updatedState.data.referenceUrls || [],
                                        currentFiles: updatedState.data.referenceFiles || []
                                    };
                                    // Enhance message with guidance if not already present
                                    if (!enhancedMessage.includes('add') && !enhancedMessage.includes('optional')) {
                                        enhancedMessage = `📚 **Reference Materials**\n\nPlease add reference materials (URLs or files) to improve content quality (optional), or click "Continue" to skip this step.`;
                                    }
                                } else if (reason === 'awaiting_approval') {
                                    metadata.outlineApproval = {
                                        outline: updatedState.outline || []
                                    };
                                    // Enhance message with guidance if not already present
                                    if (!enhancedMessage.includes('review') && !enhancedMessage.includes('approve')) {
                                        enhancedMessage = `📋 **Outline Review**\n\nPlease review the outline below and approve to continue, or provide feedback to regenerate.`;
                                    }
                                } else if (reason === 'await_auto_selection_confirmation') {
                                    // Get the field that was auto-selected from trace
                                    const lastTrace = updatedState.trace?.[updatedState.trace.length - 1];
                                    const field = lastTrace?.info?.field || 'item';
                                    const selectedValue = field === 'primaryKeyword' ? updatedState.data.primaryKeyword :
                                        field === 'secondaryKeywords' ? updatedState.data.secondaryKeywords?.join(', ') :
                                        field === 'title' ? updatedState.data.title : 'selected value';
                                    
                                    // Enhance message with confirmation prompt
                                    if (!enhancedMessage.includes('make any changes') && !enhancedMessage.includes('proceed')) {
                                        enhancedMessage = `✅ **Auto-Selected:** ${selectedValue}\n\n**Do you want to make any changes, or would you like to proceed with this?**\n\nType "yes" to proceed, or tell me what you'd like to change.`;
                                    }
                                }
                            }

                            // Add assistant message with metadata (only once, here in onComplete)
                            // Prevent duplicate messages by checking if already added
                            if (!messageAdded && enhancedMessage) {
                                messageAdded = true;
                                setMessages(prev => {
                                    // Check if this message was already added (prevent duplicates)
                                    const lastMessage = prev[prev.length - 1];
                                    if (lastMessage?.role === 'assistant' && lastMessage?.content === enhancedMessage) {
                                        return prev; // Already added, don't add again
                                    }
                                    return [
                                        ...prev,
                                        {
                                            role: 'assistant',
                                            content: enhancedMessage,
                                            ...metadata
                                        }
                                    ];
                                });
                            }

                            resolve({
                                response: data.assistantMessage,
                                updatedState,
                                metadata
                            });
                        },
                        onError: (error) => {
                            if (hasResolved) return;
                            hasResolved = true;
                            setIsStreaming(false);
                            if (setIsThinking) setIsThinking(false);
                            
                            // Check if it's a rate limit error
                            const errorMessage = error.message || 'An error occurred';
                            const isRateLimit = /rate limit|quota|429/i.test(errorMessage);
                            
                            if (isRateLimit) {
                                // Show user-friendly rate limit message
                                setMessages(prev => [
                                    ...prev,
                                    {
                                        role: 'assistant',
                                        content: `⚠️ **Rate Limit Exceeded**\n\n${errorMessage}\n\nThe system will automatically retry. Please wait a moment.`
                                    }
                                ]);
                            } else {
                                // Show general error message
                                setMessages(prev => [
                                    ...prev,
                                    {
                                        role: 'assistant',
                                        content: `❌ **Error**\n\n${errorMessage}`
                                    }
                                ]);
                            }
                            
                            console.error("Stream Error:", error);
                            reject(error);
                        }
                    }
                );
            });

        } catch (error) {
            setIsStreaming(false);
            console.error("V3 Message Error:", error);
            throw error;
        }
    }, []);

    // Backward compatible wrapper for AgentMode
    const runAgentLoop = useCallback(async (
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
    }, []);

    return { sendUserMessage, runAgentLoop };
};
