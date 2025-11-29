/**
 * API client for communicating with the backend LangGraph agent
 */

export interface AgentAPIClient {
    sendMessage: (message: string, threadId: string, currentState: any) => Promise<{ assistantMessage: string, state: any, executed: boolean }>;
    invoke: (state: any, threadId: string) => Promise<any>;
    stream: (state: any, threadId: string, onChunk: (chunk: any) => void) => Promise<void>;
    getState: (threadId: string) => Promise<any>;
    resetState: (threadId: string) => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const API_BASE = import.meta.env.VITE_AGENT_API_BASE || 'http://localhost:3001';

/**
 * Send a user message to the backend conversation handler
 * This is the PRIMARY method for interacting with the agent
 */
export async function sendMessage(
    message: string,
    threadId: string,
    currentState: any
): Promise<{ assistantMessage: string, state: any, executed: boolean }> {
    const response = await fetch(`${API_BASE}/api/agent/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, threadId, currentState }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Message processing failed');
    }

    return await response.json();
}

/**
 * Execute the agent and return the final state
 */
export async function invokeAgent(state: any, threadId: string): Promise<any> {
    const response = await fetch(`${API_BASE}/api/agent/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, threadId }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Agent execution failed');
    }

    const data = await response.json();
    return data.state;
}

/**
 * Stream agent execution with real-time updates via Server-Sent Events
 */
export async function streamAgent(
    state: any,
    threadId: string,
    onChunk: (chunk: any) => void,
    onError?: (error: Error) => void,
    onComplete?: () => void
): Promise<void> {
    const response = await fetch(`${API_BASE}/api/agent/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, threadId }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Stream failed');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;

                if (line.startsWith('event: done')) {
                    onComplete?.();
                    return;
                }

                if (line.startsWith('event: error')) {
                    const errorLine = lines[lines.indexOf(line) + 1];
                    if (errorLine?.startsWith('data: ')) {
                        const errorData = JSON.parse(errorLine.slice(6));
                        onError?.(new Error(errorData.error));
                    }
                    return;
                }

                if (line.startsWith('data: ')) {
                    try {
                        const chunk = JSON.parse(line.slice(6));
                        onChunk(chunk);
                    } catch (e) {
                        console.error('Failed to parse SSE chunk:', e);
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}

/**
 * Get current agent state for a thread
 */
export async function getAgentState(threadId: string): Promise<any> {
    const response = await fetch(`${API_BASE}/api/agent/state/${threadId}`);

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to get state');
    }

    const data = await response.json();
    return data.state;
}

/**
 * Reset/delete agent state for a thread
 */
export async function resetAgentState(threadId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/agent/state/${threadId}`, {
        method: 'DELETE',
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to reset state');
    }
}

/**
 * Send a user message and stream the response (intent + graph execution)
 */
export async function streamMessage(
    message: string,
    threadId: string,
    currentState: any,
    callbacks: {
        onIntent?: (data: { assistantMessage: string, shouldRunAgent: boolean, stateUpdates: any }) => void;
        onProgress?: (chunk: any) => void;
        onComplete?: (data: { assistantMessage: string, state: any, executed: boolean }) => void;
        onError?: (error: Error) => void;
    }
): Promise<void> {
    const response = await fetch(`${API_BASE}/api/agent/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, threadId, currentState, stream: true }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Message processing failed');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            let currentEvent: string | null = null;

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) {
                    currentEvent = null;
                    continue;
                }

                if (trimmedLine.startsWith('event: ')) {
                    currentEvent = trimmedLine.slice(7).trim();
                } else if (trimmedLine.startsWith('data: ')) {
                    const dataStr = trimmedLine.slice(6);
                    try {
                        const data = JSON.parse(dataStr);

                        if (currentEvent === 'intent') {
                            callbacks.onIntent?.(data);
                        } else if (currentEvent === 'progress') {
                            callbacks.onProgress?.(data);
                        } else if (currentEvent === 'done') {
                            callbacks.onComplete?.(data);
                            return;
                        } else if (currentEvent === 'error') {
                            callbacks.onError?.(new Error(data.error));
                            return;
                        }
                    } catch (e) {
                        console.error('Failed to parse SSE chunk:', e);
                    }
                }
            }
        }
    } catch (error: any) {
        callbacks.onError?.(error);
    } finally {
        reader.releaseLock();
    }
}

export const agentApiClient: AgentAPIClient & { streamMessage: typeof streamMessage } = {
    sendMessage,
    invoke: invokeAgent,
    stream: streamAgent,
    streamMessage,
    getState: getAgentState,
    resetState: resetAgentState,
};
