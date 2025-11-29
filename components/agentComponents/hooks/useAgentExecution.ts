import { useState } from 'react';
import { runNext as lgRunNext } from '../../../services/langgraph/agentGraph';
import { AgentState } from '../../../../server/agent/state';
import * as automationEngine from '../../../services/automationEngine';
import { getStepMessage } from '../utils/agentHelpers';
import { shouldShowProgressMessage } from '../utils/messageUtils';
import { ChatMessage } from '../../../types';

/**
 * Agent execution hook return type
 */
export interface UseAgentExecutionReturn {
	runAgentLoop: (
		working: AgentState,
		maxIterations: number,
		onProgress?: (working: AgentState) => void,
		onStateUpdate?: (working: AgentState) => void
	) => Promise<AgentState>;
}

/**
 * Custom hook for agent execution logic
 * @param setMessages - Function to set messages
 * @param setIsStreaming - Function to set streaming state
 * @returns Object with agent execution functions
 */
export const useAgentExecution = (
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
	setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>
): UseAgentExecutionReturn => {
	/**
	 * Runs the agent execution loop
	 * @param working - Initial agent state
	 * @param maxIterations - Maximum number of iterations
	 * @param onProgress - Optional callback for progress updates
	 * @param onStateUpdate - Optional callback for state updates
	 * @returns Final agent state
	 */
	const runAgentLoop = async (
		working: AgentState,
		maxIterations: number,
		onProgress?: (working: AgentState) => void,
		onStateUpdate?: (working: AgentState) => void
	): Promise<AgentState> => {
		let guard = 0;
		let lastTraceLength = 0;

		while (guard++ < maxIterations) {
			const { state: ns, halted, step } = await lgRunNext(working);
			working = ns;

			// Show progress messages
			if (shouldShowProgressMessage(working.trace.length, lastTraceLength)) {
				const latestTrace = working.trace[working.trace.length - 1];
				const stepMessage = getStepMessage(latestTrace.step, latestTrace.info);

				if (stepMessage) {
					setMessages((prev) => [
						...prev,
						{
							role: 'assistant',
							content: stepMessage,
						},
					]);
					setIsStreaming(true);

					// Small delay for UX
					await new Promise((resolve) => setTimeout(resolve, 300));
				}
				lastTraceLength = working.trace.length;
			}

			// Call progress callback
			if (onProgress) {
				onProgress(working);
			}

			// Only halt if user input is actually needed
			if (halted && automationEngine.needsUserInput(ns)) {
				break;
			}
		}

		// Call state update callback
		if (onStateUpdate) {
			onStateUpdate(working);
		}

		return working;
	};

	return {
		runAgentLoop,
	};
};

