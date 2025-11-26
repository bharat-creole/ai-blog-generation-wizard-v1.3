import { ChatMessage } from '../../../types';

/**
 * User intent analysis result
 */
export interface UserIntent {
	wantsFullAutomation: boolean;
	wantsAutomation: boolean;
	wantsBlogGeneration: boolean;
	hasDetailedInfo: boolean;
	wantsModification: boolean;
	isIrrelevant: boolean;
}

/**
 * Analyzes user input to determine their intent
 * @param content - The user's input text
 * @returns UserIntent object with boolean flags for different intents
 */
export const analyzeUserIntent = (content: string): UserIntent => {
	// Check for automation requests
	const wantsFullAutomation =
		/generate.*automatically|auto.*generate|create.*automatic|full.*automation|generate blog automatically/i.test(
			content
		);
	const wantsAutomation =
		/automat|auto.*select|auto.*choose|proceed.*automatic/i.test(
			content
		);

	// Check for general blog generation requests (without "automatically")
	const wantsBlogGeneration =
		/^(generate|create|write|make|build|produce)\s+(a\s+|an\s+|the\s+)?(blog|article|post|content)/i.test(
			content
		) && !wantsFullAutomation;

	// Check for information provided
	const hasDetailedInfo =
		/keyword|title|location|country|reference|link|url|target|primary|secondary|topic/i.test(
			content
		);

	// Check for modification requests
	const wantsModification =
		/change|modify|update|edit|different|instead|replace|go back/i.test(
			content
		);

	// Check for irrelevant queries
	const isIrrelevant =
		!hasDetailedInfo &&
		!wantsFullAutomation &&
		!wantsAutomation &&
		!wantsModification &&
		!wantsBlogGeneration &&
		!/blog|content|article|post|write|seo/i.test(content);

	return {
		wantsFullAutomation,
		wantsAutomation,
		wantsBlogGeneration,
		hasDetailedInfo,
		wantsModification,
		isIrrelevant,
	};
};

/**
 * Extracts topic from user text using pattern matching
 * @param text - The text to extract topic from
 * @returns Extracted topic string or null if not found
 */
export const extractTopicFromText = (text: string): string | null => {
	// Try to extract topic from patterns like:
	// "generate blog about AI in healthcare"
	// "create article on remote work"
	// "write blog for web development"
	const patterns = [
		/(?:about|on|regarding|concerning|for)\s+(.+)/i,
		/(?:topic|subject):\s*(.+)/i,
		/(?:generate|create|write|make)\s+(?:blog|article|post|content)\s+(.+)/i,
	];

	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match && match[1]) {
			const extracted = match[1].trim();
			// Make sure it's not just keywords like "automatically"
			if (
				extracted.length > 5 &&
				!/^(automatically|auto|manually|guided)$/i.test(
					extracted
				)
			) {
				return extracted;
			}
		}
	}
	return null;
};

/**
 * Finds topic in message history
 * @param messages - Array of chat messages
 * @param intent - User intent to avoid false positives
 * @returns Found topic string or null
 */
export const findTopicInHistory = (
	messages: ChatMessage[],
	intent: UserIntent
): string | null => {
	// Look through last 5 messages for a topic
	const recentMessages = messages.slice(-5);
	for (const msg of recentMessages) {
		if (msg.role === 'user') {
			const extracted = extractTopicFromText(msg.content);
			if (extracted) return extracted;

			// Check if it's a simple topic statement
			const content = msg.content.trim();
			if (
				content.length > 5 &&
				content.length < 150 &&
				!/^(generate|create|write|make|yes|no|ok|sure)/i.test(
					content
				) &&
				!intent.wantsModification
			) {
				return content;
			}
		}
	}
	return null;
};

/**
 * Validates if a string is a valid topic
 * @param text - Text to validate
 * @param intent - User intent to check against
 * @returns True if text is a valid topic
 */
export const validateTopic = (
	text: string,
	intent: UserIntent
): boolean => {
	return (
		text.length >= 3 &&
		!/^(yes|no|ok|okay|sure|generate|create|make|write|start)$/i.test(
			text
		) &&
		!intent.wantsModification
	);
};

