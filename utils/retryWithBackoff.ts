/**
 * Retry utility with exponential backoff for handling rate limit errors (429)
 */

interface RetryOptions {
	maxRetries?: number;
	initialDelay?: number;
	maxDelay?: number;
	backoffMultiplier?: number;
	onRetry?: (attempt: number, delay: number, error: any) => void;
}

interface RateLimitError extends Error {
	status?: number;
	retryAfter?: number; // seconds
}

/**
 * Extracts retry delay from error response
 */
const extractRetryDelay = (error: any): number | null => {
	// Check for retryAfter in error details
	if (error?.error?.details) {
		for (const detail of error.error.details) {
			if (detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo') {
				const retryDelay = detail.retryDelay;
				if (retryDelay) {
					// Convert to milliseconds
					const seconds = parseFloat(retryDelay);
					return seconds * 1000;
				}
			}
		}
	}
	
	// Check for retryAfter in message
	const message = error?.message || error?.error?.message || '';
	const retryMatch = message.match(/retry in (\d+\.?\d*)\s*s/i);
	if (retryMatch) {
		return parseFloat(retryMatch[1]) * 1000;
	}
	
	return null;
};

/**
 * Checks if error is a rate limit error (429)
 */
const isRateLimitError = (error: any): boolean => {
	return (
		error?.status === 429 ||
		error?.error?.code === 429 ||
		error?.error?.status === 'RESOURCE_EXHAUSTED' ||
		(error?.message && /quota|rate limit|429/i.test(error.message))
	);
};

/**
 * Retries a function with exponential backoff, with special handling for 429 rate limit errors
 */
export const retryWithBackoff = async <T>(
	fn: () => Promise<T>,
	options: RetryOptions = {}
): Promise<T> => {
	const {
		maxRetries = 3,
		initialDelay = 1000,
		maxDelay = 60000, // 60 seconds max
		backoffMultiplier = 2,
		onRetry,
	} = options;

	let lastError: any;
	let delay = initialDelay;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error: any) {
			lastError = error;

			// If it's a rate limit error, extract retry delay from error
			if (isRateLimitError(error)) {
				const retryDelay = extractRetryDelay(error);
				if (retryDelay) {
					delay = Math.min(retryDelay, maxDelay);
				} else {
					// Use exponential backoff if no retry delay specified
					delay = Math.min(delay * backoffMultiplier, maxDelay);
				}
			} else {
				// For non-rate-limit errors, use exponential backoff
				delay = Math.min(delay * backoffMultiplier, maxDelay);
			}

			// Don't retry on last attempt
			if (attempt === maxRetries) {
				break;
			}

			// Call retry callback if provided
			if (onRetry) {
				onRetry(attempt + 1, delay, error);
			}

			// Wait before retrying
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	// If we get here, all retries failed
	throw lastError;
};

/**
 * Creates a user-friendly error message for rate limit errors
 */
export const getRateLimitErrorMessage = (error: any): string => {
	if (!isRateLimitError(error)) {
		return error?.message || 'An unexpected error occurred';
	}

	const retryDelay = extractRetryDelay(error);
	if (retryDelay) {
		const seconds = Math.ceil(retryDelay / 1000);
		return `Rate limit exceeded. Please wait ${seconds} seconds before trying again. The system will automatically retry.`;
	}

	return 'Rate limit exceeded. Please wait a moment and try again.';
};

