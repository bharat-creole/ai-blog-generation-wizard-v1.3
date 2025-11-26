import { ChatMessage, OutlineSection } from '../../../types';
import { AgentState } from '../../../services/langgraph/agentGraph';

/**
 * Creates a user chat message
 * @param content - Message content
 * @returns ChatMessage object
 */
export const createUserMessage = (content: string): ChatMessage => {
	return {
		role: 'user',
		content: content.trim(),
	};
};

/**
 * Creates an assistant chat message with optional metadata
 * @param content - Message content
 * @param metadata - Optional metadata (keywordSelection, titleSelection, etc.)
 * @returns ChatMessage object
 */
export const createAssistantMessage = (
	content: string,
	metadata?: Partial<ChatMessage>
): ChatMessage => {
	return {
		role: 'assistant',
		content,
		...metadata,
	};
};

/**
 * Creates an outline approval message
 * @param outline - Array of outline sections
 * @returns ChatMessage with outlineApproval metadata
 */
export const createOutlineApprovalMessage = (
	outline: OutlineSection[]
): ChatMessage => {
	return {
		role: 'assistant',
		content:
			'📋 Outline is ready! Review it below and approve to continue, or provide feedback to regenerate:',
		outlineApproval: {
			outline,
		},
	};
};

/**
 * Creates a keyword selection message
 * @param type - 'primary' or 'secondary'
 * @param candidates - Array of keyword candidates
 * @returns ChatMessage with keywordSelection metadata
 */
export const createKeywordSelectionMessage = (
	type: 'primary' | 'secondary',
	candidates: Array<{ text: string; volume: number; difficulty: number }>
): ChatMessage => {
	const content =
		type === 'primary'
			? '🎯 Please select a primary keyword from the options below:\n\n💡 Tip: If you would like to provide your own primary keyword, simply type it in the chat!'
			: '🎯 Select up to 5 secondary keywords:\n\n💡 Tip: If you would like to provide your own secondary keywords, simply type them in the chat (comma-separated)!';

	return {
		role: 'assistant',
		content,
		keywordSelection: {
			type,
			candidates: candidates.slice(0, type === 'primary' ? 10 : 12),
		},
	};
};

/**
 * Creates a title selection message
 * @param titles - Array of title options
 * @returns ChatMessage with titleSelection metadata
 */
export const createTitleSelectionMessage = (
	titles: string[]
): ChatMessage => {
	return {
		role: 'assistant',
		content:
			'📝 Select a blog title from the options below:\n\n💡 Tip: If you would like to provide your own title, simply type it in the chat!',
		titleSelection: {
			titles,
		},
	};
};

/**
 * Creates an interlinking form message
 * @param currentLinks - Current interlinks array
 * @returns ChatMessage with interlinkingForm metadata
 */
export const createInterlinkingFormMessage = (
	currentLinks: Array<{ id: string; keyword: string; url: string }>
): ChatMessage => {
	return {
		role: 'assistant',
		content:
			'🔗 Add internal/external links (optional) or click "Continue" to skip:',
		interlinkingForm: {
			currentLinks,
		},
	};
};

/**
 * Creates a references form message
 * @param currentUrls - Current reference URLs
 * @param currentFiles - Current reference files
 * @returns ChatMessage with referencesForm metadata
 */
export const createReferencesFormMessage = (
	currentUrls: string[],
	currentFiles: Array<{ name: string; mimeType: string; base64: string }>
): ChatMessage => {
	return {
		role: 'assistant',
		content:
			'📚 Add reference materials (URLs or files) to improve content quality, or click "Continue" to skip:',
		referencesForm: {
			currentUrls,
			currentFiles,
		},
	};
};

/**
 * Checks if a progress message should be shown based on trace length
 * @param traceLength - Current trace length
 * @param lastTraceLength - Previous trace length
 * @returns True if progress message should be shown
 */
export const shouldShowProgressMessage = (
	traceLength: number,
	lastTraceLength: number
): boolean => {
	return traceLength > lastTraceLength;
};

