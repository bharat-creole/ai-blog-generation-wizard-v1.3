import { useState, useCallback } from 'react';
import { graph } from '../../../services/v2/graph';
import { AgentState as AgentStateV2 } from '../../../services/v2/state';
import { AgentState as AgentStateV1 } from '../../../../server/agent/state'; // Legacy type
import { ChatMessage } from '../../../types';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import * as automationEngine from '../../../services/automationEngine';
import { getStepMessage } from '../utils/agentHelpers';
import { shouldShowProgressMessage } from '../utils/messageUtils';

/**
 * Agent execution hook return type
 */
export interface UseAgentExecutionReturn {
    runAgentLoop: (
        working: AgentStateV1, // Accepts V1 state from UI
        maxIterations: number,
        onProgress?: (working: AgentStateV1) => void,
        onStateUpdate?: (working: AgentStateV1) => void
    ) => Promise<AgentStateV1>; // Returns V1 state to UI
}

/**
 * Helper to convert V1 state to V2 state
 */
const mapV1ToV2 = (v1: AgentStateV1): Partial<AgentStateV2> => {
    return {
        messages: v1.messages.map(m =>
            m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
        ),
        data: v1.data,
        apiKey: v1.apiKey,
        outline: v1.outline,
        outlineApproved: v1.outlineApproved,
        draft: v1.draft,
        progress: v1.progress,
        preferences: v1.preferences,
        trace: v1.trace,
        halt: v1.halt || null,
        userProvidedFields: v1.userProvidedFields || new Set(), // Map new field
        autoFillFields: v1.autoFillFields || new Set(), // Map new field
    };
};

/**
 * Helper to convert V2 state back to V1 state
 */
const mapV2ToV1 = (v2: AgentStateV2, originalV1: AgentStateV1): AgentStateV1 => {
    return {
        ...originalV1,
        data: v2.data,
        outline: v2.outline,
        outlineApproved: v2.outlineApproved,
        draft: v2.draft,
        progress: v2.progress,
        preferences: v2.preferences,
        trace: v2.trace,
        halt: v2.halt,
        // Map messages back if needed, but UI usually manages messages separately
    };
};

export const useAgentExecutionV2 = (
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
    setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>
): UseAgentExecutionReturn => {

    const runAgentLoop = useCallback(async (
        working: AgentStateV1,
        maxIterations: number,
        onProgress?: (working: AgentStateV1) => void,
        onStateUpdate?: (working: AgentStateV1) => void
    ): Promise<AgentStateV1> => {

        // 1. Convert V1 state to V2 input
        const inputState = mapV1ToV2(working);
        const threadId = 'thread-1'; // TODO: Manage thread IDs properly
        const config = { configurable: { thread_id: threadId } };

        let currentV2State: AgentStateV2 | null = null;
        let lastTraceLength = working.trace.length;

        try {
            // 2. Stream the graph execution
            const stream = await graph.stream(inputState, config);

            for await (const chunk of stream) {
                // chunk is the state update from the last node
                // We need to merge it to get the full current state
                // Actually, graph.stream returns the full state if configured, or updates.
                // By default LangGraph stream returns the output of the node.

                // For simplicity, let's assume we can get the full state from the checkpointer 
                // or we construct it. But `chunk` usually contains the keys updated.

                // Let's get the latest state from the graph
                const stateSnapshot = await graph.getState(config);
                currentV2State = stateSnapshot.values as AgentStateV2;

                // Map back to V1 for UI updates
                const currentV1State = mapV2ToV1(currentV2State, working);

                // Show progress messages
                if (shouldShowProgressMessage(currentV1State.trace.length, lastTraceLength)) {
                    const latestTrace = currentV1State.trace[currentV1State.trace.length - 1];
                    const stepMessage = getStepMessage(latestTrace.step, latestTrace.info);

                    if (stepMessage) {
                        setMessages((prev) => [
                            ...prev,
                            { role: 'assistant', content: stepMessage },
                        ]);
                        setIsStreaming(true);
                        await new Promise((resolve) => setTimeout(resolve, 300));
                    }
                    lastTraceLength = currentV1State.trace.length;
                }

                if (onProgress) {
                    onProgress(currentV1State);
                }

                // Check for halt
                if (currentV2State.halt && automationEngine.needsUserInput(currentV1State)) {
                    break;
                }
            }

            // Final state update
            if (currentV2State) {
                const finalV1State = mapV2ToV1(currentV2State, working);
                if (onStateUpdate) {
                    onStateUpdate(finalV1State);
                }
                return finalV1State;
            }

            return working;

        } catch (error) {
            console.error("V2 Execution Error:", error);
            throw error;
        }
    }, [setMessages, setIsStreaming]);

    return { runAgentLoop };
};
