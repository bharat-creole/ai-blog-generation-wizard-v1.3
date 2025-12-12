/**
 * API client for communicating with the backend LangGraph agent
 */

import { getAuthHeaders } from './authUtils';

export interface AgentAPIClient {
	sendMessage: (
		message: string,
		threadId: string,
		currentState: any
	) => Promise<{ assistantMessage: string; state: any; executed: boolean }>;
	invoke: (state: any, threadId: string) => Promise<any>;
	stream: (
		state: any,
		threadId: string,
		onChunk: (chunk: any) => void
	) => Promise<void>;
	getState: (threadId: string) => Promise<any>;
	resetState: (threadId: string) => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const API_BASE = import.meta.env.VITE_AGENT_API_BASE || 'http://localhost:3001';

// Get API key from environment variable (for client-side)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const getEnvApiKey = (): string | undefined => {
	try {
		// @ts-ignore
		return (
			import.meta.env?.VITE_GEMINI_API_KEY ||
			import.meta.env?.GEMINI_API_KEY ||
			undefined
		);
	} catch (e) {
		return undefined;
	}
};

/**
 * Send a user message to the backend conversation handler
 * This is the PRIMARY method for interacting with the agent
 */
export async function sendMessage(
	message: string,
	threadId: string,
	currentState: any
): Promise<{ assistantMessage: string; state: any; executed: boolean }> {
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
						const errorData = JSON.parse(
							errorLine.slice(6)
						);
						onError?.(new Error(errorData.error));
					}
					return;
				}

				if (line.startsWith('data: ')) {
					try {
						const chunk = JSON.parse(line.slice(6));
						onChunk(chunk);
					} catch (e) {
						console.error(
							'Failed to parse SSE chunk:',
							e
						);
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
 * @param abortController - Optional AbortController to cancel the stream
 */
export async function streamMessage(
	message: string,
	threadId: string,
	currentState: any,
	apiKey?: string,
	callbacks?: {
		onIntent?: (data: {
			assistantMessage: string;
			shouldRunAgent: boolean;
			stateUpdates: any;
		}) => void;
		onProgress?: (chunk: any) => void;
		onComplete?: (data: {
			assistantMessage: string;
			state: any;
			executed: boolean;
		}) => void;
		onError?: (error: Error) => void;
	},
	abortController?: AbortController
): Promise<void> {
	// Handle backward compatibility: if apiKey is an object, it's actually callbacks
	let actualApiKey: string | undefined = apiKey;
	let actualCallbacks = callbacks;

	if (!callbacks && typeof apiKey === 'object' && apiKey !== null) {
		actualCallbacks = apiKey as any;
		actualApiKey = undefined;
	}

	// Ensure apiKey is always passed if provided
	const requestBody: any = {
		message,
		threadId,
		currentState,
		stream: true,
	};

	// Get apiKey from parameter, state, or environment variable (in that order)
	// API key is optional - backend will use GEMINI_API_KEY from .env if not provided
	const envApiKey = getEnvApiKey();
	const finalApiKey = actualApiKey || currentState?.apiKey || envApiKey;

	// Include apiKey in request only if provided (optional - backend uses .env by default)
	if (finalApiKey) {
		requestBody.apiKey = finalApiKey;
	}
	// If no API key provided, backend will use GEMINI_API_KEY from .env file

	const response = await fetch(`${API_BASE}/api/agent/message`, {
		method: 'POST',
		headers: getAuthHeaders(), // ✨ Use auth headers with JWT token
		body: JSON.stringify(requestBody),
		signal: abortController?.signal, // Support cancellation
	});

	if (!response.ok) {
		const error = await response.json();
		throw new Error(error.error || 'Message processing failed');
	}

	const reader = response.body?.getReader();
	if (!reader) throw new Error('No response body');

	const decoder = new TextDecoder();
	let buffer = '';
	let lastKeepaliveTime = Date.now();
	const KEEPALIVE_TIMEOUT = 60000; // 60 seconds
	let keepaliveTimer: NodeJS.Timeout | null = null;

	// Set up keepalive timeout check
	const resetKeepaliveTimer = () => {
		if (keepaliveTimer) clearTimeout(keepaliveTimer);
		keepaliveTimer = setTimeout(() => {
			const timeSinceLastKeepalive = Date.now() - lastKeepaliveTime;
			if (timeSinceLastKeepalive > KEEPALIVE_TIMEOUT) {
				console.warn(
					'⚠️ SSE connection timeout - no data received'
				);
				actualCallbacks?.onError?.(
					new Error('Connection timeout - no data received')
				);
				reader.cancel();
			}
		}, KEEPALIVE_TIMEOUT);
	};

	resetKeepaliveTimer();

	try {
		while (true) {
			// Check if aborted
			if (abortController?.signal.aborted) {
				console.log('🛑 Stream aborted by user');
				reader.cancel();
				break;
			}

			const { done, value } = await reader.read();
			if (done) break;

			// Update keepalive timestamp
			lastKeepaliveTime = Date.now();
			resetKeepaliveTimer();

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			let currentEvent: string | null = null;

			for (const line of lines) {
				const trimmedLine = line.trim();

				// Handle keepalive comments
				if (trimmedLine.startsWith(': ')) {
					// Keepalive ping - ignore but update timestamp
					lastKeepaliveTime = Date.now();
					resetKeepaliveTimer();
					continue;
				}

				if (!trimmedLine) {
					currentEvent = null;
					continue;
				}

				if (trimmedLine.startsWith('event: ')) {
					currentEvent = trimmedLine.slice(7).trim();
				} else if (trimmedLine.startsWith('data: ')) {
					const dataStr = trimmedLine.slice(6);
					try {
						// Handle incomplete JSON by checking if buffer has more data
						let data: any;
						try {
							data = JSON.parse(dataStr);
						} catch (parseError) {
							// If JSON is incomplete, it might be in the buffer
							// Wait for next chunk
							console.warn(
								'⚠️ Incomplete JSON chunk, waiting for more data'
							);
							continue;
						}

						if (currentEvent === 'intent') {
							actualCallbacks?.onIntent?.(data);
						} else if (currentEvent === 'progress') {
							actualCallbacks?.onProgress?.(data);
						} else if (currentEvent === 'done') {
							actualCallbacks?.onComplete?.(data);
							if (keepaliveTimer)
								clearTimeout(keepaliveTimer);
							return;
						} else if (currentEvent === 'error') {
							actualCallbacks?.onError?.(
								new Error(
									data.error ||
										'Unknown error'
								)
							);
							if (keepaliveTimer)
								clearTimeout(keepaliveTimer);
							return;
						} else if (!currentEvent && data) {
							// Handle data without explicit event (fallback)
							if (
								data.assistantMessage ||
								data.state
							) {
								// Looks like a done event
								actualCallbacks?.onComplete?.(
									data
								);
								if (keepaliveTimer)
									clearTimeout(
										keepaliveTimer
									);
								return;
							}
						}
					} catch (e) {
						console.error(
							'❌ Failed to parse SSE chunk:',
							e,
							'Data:',
							dataStr.substring(0, 100)
						);
					}
				}
			}
		}
	} catch (error: any) {
		// Don't call onError if it was a user-initiated abort
		if (
			error.name === 'AbortError' ||
			abortController?.signal.aborted
		) {
			console.log('🛑 Stream cancelled');
			return;
		}
		console.error('❌ SSE stream error:', error);
		actualCallbacks?.onError?.(error);
	} finally {
		if (keepaliveTimer) clearTimeout(keepaliveTimer);
		try {
			reader.releaseLock();
		} catch (e) {
			// Reader might already be released
		}
	}
}

export const agentApiClient: AgentAPIClient & {
	streamMessage: typeof streamMessage;
} = {
	sendMessage,
	invoke: invokeAgent,
	stream: streamAgent,
	streamMessage,
	getState: getAgentState,
	resetState: resetAgentState,
};
