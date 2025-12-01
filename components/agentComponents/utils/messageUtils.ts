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
			'📋 **Review and approve your blog outline**\n\nThe outline below shows the structure and sections for your blog post. Review it carefully to ensure it covers all the important points and flows logically.\n\n💡 *Tip: You can approve to continue with blog generation, or provide feedback if you\'d like any changes to the outline.*',
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
			? '🎯 **What main keyword should this article rank for?**\n\nSelect the primary keyword that best represents your target search term. This will be the main focus keyword for SEO optimization.\n\n💡 *Tip: You can also type your own primary keyword in the chat if you prefer.*'
			: '🎯 **Which secondary keywords should we target?**\n\nSelect up to 5 related keywords that complement your primary keyword. These help cover related search terms and improve your content\'s reach.\n\n💡 *Tip: You can also type your own secondary keywords in the chat (comma-separated).*';

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
			'📝 **Which title should we use for your blog post?**\n\nChoose the title that best captures your content and appeals to your target audience. A great title is clear, engaging, and includes your primary keyword.\n\n💡 *Tip: You can also type your own custom title in the chat if you prefer.*',
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
			'🔗 **Would you like to add internal or external links to your blog?**\n\nAdding relevant links helps improve SEO, provides additional context to readers, and creates a better user experience. You can link to your own content (internal links) or authoritative external sources.\n\n💡 *Tip: This step is optional. You can click "Continue" to skip and proceed without adding links.*',
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
			'📚 **Do you have reference materials to enhance your blog content?**\n\nAdding reference URLs or files helps ensure accuracy, provides credible sources, and allows the AI to incorporate specific information from your materials into the blog post.\n\n💡 *Tip: This step is optional. You can click "Continue" to skip and proceed without adding references.*',
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

