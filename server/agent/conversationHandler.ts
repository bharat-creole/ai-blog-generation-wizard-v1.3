/**
 * Backend Conversation Handler - Processes user messages and manages conversation state
 * This is the main orchestrator that determines intent and handles modifications
 */

import { AgentState } from './state';
import { classifyIntent, UserIntent } from './intentClassifier';
import { BlogData } from '../../types';
import * as automationEngine from '../../services/automationEngine';

/**
 * Validates if a topic is valid (not gibberish or irrelevant)
 */
const isValidTopic = (topic: string | null | undefined): boolean => {
	if (!topic || !topic.trim()) return false;

	const trimmed = topic.trim();

	// Too short to be meaningful
	if (trimmed.length < 3) return false;

	// Check for common invalid patterns
	const invalidPatterns = [
		/^[^a-zA-Z]*$/, // No letters at all
		/^(blog|it|yourself|everything|anything|something|whatever|random)$/i, // Common invalid words
		/^[a-z]{1,2}$/i, // Single or double letter
	];

	for (const pattern of invalidPatterns) {
		if (pattern.test(trimmed)) return false;
	}

	// Check for gibberish: too many repeated characters or random character sequences
	const hasRepeatedChars = /(.)\1{4,}/.test(trimmed); // Same char repeated 5+ times
	const hasRandomChars = /[^a-zA-Z0-9\s]{3,}/.test(trimmed); // 3+ special chars in a row
	const tooManySpecialChars =
		(trimmed.match(/[^a-zA-Z0-9\s]/g) || []).length >
		trimmed.length * 0.3; // More than 30% special chars

	if (hasRepeatedChars || hasRandomChars || tooManySpecialChars)
		return false;

	// Check if it looks like random keyboard mashing (no vowels or all consonants)
	const hasVowels = /[aeiouAEIOU]/.test(trimmed);
	const consonantRatio =
		(
			trimmed.match(
				/[bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ]/g
			) || []
		).length / trimmed.length;

	// If no vowels and high consonant ratio, likely gibberish
	if (!hasVowels && consonantRatio > 0.7 && trimmed.length > 5)
		return false;

	// Check for common words that aren't topics
	const commonNonTopics = [
		'yes',
		'no',
		'ok',
		'okay',
		'sure',
		'maybe',
		'thanks',
		'thank you',
	];
	if (commonNonTopics.includes(trimmed.toLowerCase())) return false;

	return true;
};

/**
 * Detects if input is gibberish/nonsensical
 */
const isGibberish = (text: string): boolean => {
	if (!text || text.trim().length < 3) return false;

	const trimmed = text.trim();

	// Check for random character sequences (like "dljfdlhassdnlajsdnaljs")
	// High ratio of consonants to vowels, no recognizable words
	const vowels = (trimmed.match(/[aeiouAEIOU]/g) || []).length;
	const consonants = (
		trimmed.match(/[bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ]/g) || []
	).length;
	const totalLetters = vowels + consonants;

	if (totalLetters === 0) return true; // No letters at all

	// If very low vowel ratio and long string, likely gibberish
	const vowelRatio = vowels / totalLetters;
	if (vowelRatio < 0.15 && trimmed.length > 8) return true;

	// Check for repeated character patterns (like "aaaaa" or "abcabcabc")
	const hasRepeatedPattern = /(.{2,})\1{2,}/.test(trimmed);
	if (hasRepeatedPattern && trimmed.length > 10) return true;

	// Check if it's mostly special characters or numbers
	const letterRatio = totalLetters / trimmed.length;
	if (letterRatio < 0.5 && trimmed.length > 5) return true;

	return false;
};

export interface ConversationResponse {
	assistantMessage: string;
	assistantMessages?: string[]; // Optional array of separate messages for different steps
	stateUpdates: Partial<AgentState>;
	shouldRunAgent: boolean;
}

/**
 * Main entry point - processes user message and returns appropriate response
 */
export const processMessage = async (
	userMessage: string,
	currentState: AgentState,
	apiKey: string
): Promise<ConversationResponse> => {
	console.log('📥 [BACKEND CONVERSATION HANDLER] Processing message');
	console.log(`   User Query: "${userMessage}"`);

	// Log state at every user query
	console.log('📊 [STATE] Current State:');
	console.log(`   currentStep: ${currentState.currentStep || 'undefined'}`);
	console.log(`   topic: ${currentState.data?.topic || 'none'}`);
	console.log(
		`   primaryKeyword: ${currentState.data?.primaryKeyword || 'none'}`
	);
	console.log(`   title: ${currentState.data?.title || 'none'}`);
	console.log(
		`   hasOutline: ${currentState.outline?.length > 0 ? 'yes' : 'no'}`
	);
	console.log(
		`   outlineApproved: ${currentState.outlineApproved || false}`
	);
	console.log(`   halt: ${currentState.halt?.reason || 'none'}`);
	console.log(
		`   automationLevel: ${
			currentState.preferences?.automationLevel || 'none'
		}`
	);

	// Step 1: Classify intent
	const intent: UserIntent = await classifyIntent(
		userMessage,
		currentState,
		apiKey
	);

	// Log intent at every user query
	console.log('🎯 [INTENT] Classified Intent:');
	console.log(`   type: ${intent.type}`);
	console.log(`   autoFillRequested: ${intent.autoFillRequested || false}`);
	console.log(`   specificRequest: ${intent.specificRequest || 'none'}`);
	if (intent.extractedData) {
		console.log(`   extractedData:`, {
			topic: intent.extractedData.topic || null,
			primaryKeyword: intent.extractedData.primaryKeyword || null,
			title: intent.extractedData.title || null,
			secondaryKeywords:
				intent.extractedData.secondaryKeywords?.length || 0,
		});
	}
	if (intent.controlPreferences) {
		console.log(`   controlPreferences:`, intent.controlPreferences);
	}

	// Step 2: Handle different intent types
	switch (intent.type) {
		case 'greeting':
			return handleGreeting(currentState);

		case 'help_request':
			return handleHelpRequest(currentState);

		case 'off_topic':
			// Check if the message itself is gibberish
			if (isGibberish(userMessage)) {
				return {
					assistantMessage:
						"I couldn't understand your message. Please provide a clear blog topic to get started.\\n\\n**Examples:**\\n- 'Write about cloud computing'\\n- 'Topic: Machine learning'\\n- 'I want to create a blog on web development'",
					stateUpdates: {},
					shouldRunAgent: false,
				};
			}
			return handleOffTopic(currentState);

		case 'full_automation':
			return handleFullAutomation(
				userMessage,
				intent,
				currentState
			);

		case 'partial_info':
			return handlePartialInfo(userMessage, intent, currentState);

		case 'refinement':
			return handleRefinement(userMessage, intent, currentState);

		case 'approval':
			return handleApproval(currentState);

		case 'skip_step':
			return handleSkipStep(currentState);

		default:
			return {
				assistantMessage: "Let's proceed with your blog.",
				stateUpdates: {},
				shouldRunAgent: true,
			};
	}
};

// Helper to check if user has started providing blog information
const hasStartedBlogCreation = (state: AgentState): boolean => {
	return !!(
		state.data.topic ||
		state.data.primaryKeyword ||
		state.data.title ||
		state.data.secondaryKeywords?.length > 0
	);
};

// Handler for greetings
const handleGreeting = (currentState: AgentState): ConversationResponse => {
	if (hasStartedBlogCreation(currentState)) {
		return {
			assistantMessage: `Hello! 👋 Nice to hear from you again!\\n\\nLet's continue with your blog.`,
			stateUpdates: {},
			shouldRunAgent: false,
		};
	}

	return {
		assistantMessage:
			'Hello! 👋 I\'m your Blog Agent. Tell me what topic you\'d like to write about, or say **"generate blog automatically"** to let me handle everything!',
		stateUpdates: {},
		shouldRunAgent: false,
	};
};

// Handler for help requests
const handleHelpRequest = (_currentState: AgentState): ConversationResponse => {
	return {
		assistantMessage:
			"I'm your AI Blog Agent! 🤖 I can help you:\\n\\n✍️ **Create SEO-Optimized Blogs**\\n🔍 **Keyword Research**\\n📝 **Title Generation**\\n📋  **Content Outlines**\\n\\nJust tell me your blog topic to get started!",
		stateUpdates: {},
		shouldRunAgent: false,
	};
};

// Handler for off-topic queries
const handleOffTopic = (currentState: AgentState): ConversationResponse => {
	// Check if user has already started blog creation
	if (hasStartedBlogCreation(currentState)) {
		return {
			assistantMessage:
				"I'm specifically designed to help you create blog content! 📝\\n\\nLet's continue with your blog. What would you like to do next?",
			stateUpdates: {},
			shouldRunAgent: false,
		};
	}

	return {
		assistantMessage:
			"I'm specifically designed to help you create blog content! 📝\\n\\nPlease provide a clear, meaningful blog topic to get started.\\n\\n**Examples:**\\n- 'Cloud computing'\\n- 'Machine learning'\\n- 'Web development best practices'",
		stateUpdates: {},
		shouldRunAgent: false,
	};
};

// Handler for full automation
const handleFullAutomation = (
	userMessage: string,
	intent: UserIntent,
	currentState: AgentState
): ConversationResponse => {
	const extractedData = intent.extractedData || {};

	// ✨ VALIDATION: Check if topic is valid (if provided)
	if (extractedData.topic) {
		// Check if the topic itself is gibberish
		if (isGibberish(extractedData.topic)) {
			return {
				assistantMessage:
					"I couldn't understand that topic. Please provide a clear, meaningful topic for your blog.\n\n**Examples of good topics:**\n- 'Cloud computing'\n- 'Machine learning'\n- 'Remote work benefits'",
				stateUpdates: {},
				shouldRunAgent: false,
			};
		}

		// Check if topic is valid
		if (!isValidTopic(extractedData.topic)) {
			return {
				assistantMessage:
					"That doesn't look like a valid blog topic. Please provide a clear topic related to your blog content.",
				stateUpdates: {},
				shouldRunAgent: false,
			};
		}
	}

	// Check if the entire message is gibberish (when no valid topic extracted)
	if (!extractedData.topic && isGibberish(userMessage)) {
		return {
			assistantMessage:
				"I couldn't understand your message. Please provide a clear blog topic or say 'generate blog automatically' with a topic.\n\n**Examples:**\n- 'Generate blog automatically about cloud computing'\n- 'Write about machine learning, you handle it'",
			stateUpdates: {},
			shouldRunAgent: false,
		};
	}

	const updatedData = {
		...currentState.data,
		...(extractedData.topic && { topic: extractedData.topic }),
		targetLocation: currentState.data.targetLocation || 'United States',
	};

	return {
		assistantMessage: extractedData.topic
			? `Great! I'll create a blog about "${extractedData.topic}" in full automation mode.`
			: "I'll handle everything automatically! What's your blog topic?",
		stateUpdates: {
			data: updatedData as BlogData,
			preferences: {
				automationLevel: 'full',
				skipOptionalSteps: true,
				autoSelectBestOptions: true,
			},
			autoFillFields: new Set([
				'primaryKeyword',
				'secondaryKeywords',
				'title',
			]),
		},
		shouldRunAgent: !!extractedData.topic,
	};
};

// Handler for partial info
const handlePartialInfo = (
	userMessage: string,
	intent: UserIntent,
	currentState: AgentState
): ConversationResponse => {
	const extractedData = intent.extractedData || {};

	// ✨ VALIDATION: Check if topic is valid (not gibberish or invalid)
	if (extractedData.topic) {
		// Check if the topic itself is gibberish
		if (isGibberish(extractedData.topic)) {
			return {
				assistantMessage:
					"I couldn't understand that topic. Please provide a clear, meaningful topic for your blog.\n\n**Examples of good topics:**\n- 'Cloud computing'\n- 'Machine learning'\n- 'Remote work benefits'\n- 'Web development best practices'",
				stateUpdates: {},
				shouldRunAgent: false,
			};
		}

		// Check if topic is valid
		if (!isValidTopic(extractedData.topic)) {
			return {
				assistantMessage:
					"That doesn't look like a valid blog topic. Please provide a clear topic related to your blog content.\n\n**Examples:**\n- 'Artificial intelligence in healthcare'\n- 'Best practices for e-commerce'\n- 'Sustainable energy solutions'",
				stateUpdates: {},
				shouldRunAgent: false,
			};
		}
	}

	// Check if the entire message is gibberish (when no valid data extracted)
	if (
		!extractedData.topic &&
		!extractedData.primaryKeyword &&
		!extractedData.title &&
		!extractedData.secondaryKeywords
	) {
		if (isGibberish(userMessage)) {
			return {
				assistantMessage:
					"I couldn't understand your message. Please provide a clear blog topic or tell me what you'd like to write about.\n\n**Examples:**\n- 'Write about cloud computing'\n- 'Topic: Machine learning'\n- 'I want to create a blog on web development'",
				stateUpdates: {},
				shouldRunAgent: false,
			};
		}
	}

	// ✨ STEP 1: Update ALL provided fields in state first
	const updatedData = {
		...currentState.data,
		...(extractedData.topic && { topic: extractedData.topic }),
		...(extractedData.primaryKeyword && {
			primaryKeyword: extractedData.primaryKeyword,
		}),
		...(extractedData.secondaryKeywords && {
			secondaryKeywords: extractedData.secondaryKeywords,
		}),
		...(extractedData.title && { title: extractedData.title }),
		...(extractedData.targetLocation && {
			targetLocation: extractedData.targetLocation,
		}),
	};

	const capturedItems: string[] = [];
	if (extractedData.topic)
		capturedItems.push(`topic: "${extractedData.topic}"`);
	if (extractedData.primaryKeyword)
		capturedItems.push(`keyword: "${extractedData.primaryKeyword}"`);
	if (extractedData.secondaryKeywords)
		capturedItems.push(
			`secondary keywords: ${extractedData.secondaryKeywords.length}`
		);
	if (extractedData.title)
		capturedItems.push(`title: "${extractedData.title}"`);

	// Create base capture message with better formatting
	const baseMessage =
		capturedItems.length > 0
			? `✅ **Information captured!**\n\nI've saved: ${capturedItems.join(
					', '
			  )}.`
			: `✅ **Ready to proceed!**`;

	// ✨ CRITICAL: Reset flags if critical fields changed
	const criticalFieldsUpdated =
		(extractedData.topic &&
			extractedData.topic !== currentState.data.topic) ||
		(extractedData.primaryKeyword &&
			extractedData.primaryKeyword !==
				currentState.data.primaryKeyword);

	// Helper to safely convert to Set
	const toSet = (
		value: Set<string> | string[] | undefined
	): Set<string> => {
		if (!value) return new Set();
		if (value instanceof Set) return value;
		if (Array.isArray(value)) return new Set(value);
		return new Set();
	};

	const stateUpdates: Partial<AgentState> = {
		data: updatedData as BlogData,
		// Merge with existing userProvidedFields instead of replacing
		userProvidedFields: new Set([
			...toSet(currentState.userProvidedFields),
			...Object.keys(extractedData).filter(
				(key) =>
					extractedData[
						key as keyof typeof extractedData
					] != null
			),
		]),
	};

	if (criticalFieldsUpdated) {
		console.log(
			'🔄 [FLOW RESTART] Critical fields updated, resetting progress'
		);
		stateUpdates.outline = [];
		stateUpdates.outlineApproved = false;
		stateUpdates.draft = '';
		stateUpdates.progress = { sectionIndex: 0 };
		stateUpdates.halt = null;
	}

	// ✨ STEP 2: After updating state, determine what's still missing
	// Check the UPDATED state (not just extracted data) to find the first missing step
	const determineNextStep = (): {
		step: AgentState['currentStep'];
		message: string;
		shouldRunAgent: boolean;
	} => {
		// Check in order: topic → primary_keyword → secondary_keywords → title → outline

		// 1. Check if topic is missing or invalid
		if (
			!updatedData.topic?.trim() ||
			!isValidTopic(updatedData.topic)
		) {
			return {
				step: 'topic',
				message: 'Please provide a valid topic for your blog.\n\n**Examples:**\n- "Cloud computing"\n- "Machine learning"\n- "Web development best practices"',
				shouldRunAgent: false,
			};
		}

		// 2. Check if primary keyword is missing
		if (!updatedData.primaryKeyword?.trim()) {
			return {
				step: 'primary_keyword',
				message: "🔍 **Researching primary keywords...**\n\nI'm analyzing your topic to find the best primary keyword options for SEO optimization.",
				shouldRunAgent: true,
			};
		}

		// 3. Check if secondary keywords are missing
		if (
			!updatedData.secondaryKeywords ||
			updatedData.secondaryKeywords.length === 0
		) {
			return {
				step: 'secondary_keywords',
				message: "🔍 **Researching secondary keywords...**\n\nI'm finding related keywords that complement your primary keyword to expand your content's reach.",
				shouldRunAgent: true,
			};
		}

		// 4. Check if title is missing
		if (!updatedData.title?.trim()) {
			return {
				step: 'title',
				message: "📝 **Generating title options...**\n\nI'm creating engaging title options that incorporate your keywords and appeal to your target audience.",
				shouldRunAgent: true,
			};
		}

		// 5. Title is set, check optional steps or proceed to outline
		if (currentState.preferences?.automationLevel === 'full') {
			// Full automation - skip optional steps and go straight to outline
			return {
				step: 'outline',
				message: 'Generating outline now.',
				shouldRunAgent: true,
			};
		} else {
			// Guided mode - check optional steps
			if (
				!updatedData.referenceUrls ||
				updatedData.referenceUrls.length === 0
			) {
				return {
					step: 'references',
					message: 'Please add any reference links for research (optional).',
					shouldRunAgent: false,
				};
			} else if (
				!updatedData.interlinks ||
				updatedData.interlinks.length === 0
			) {
				return {
					step: 'interlinking',
					message: 'Please add any internal links to your existing content (optional).',
					shouldRunAgent: false,
				};
			} else {
				// Both optional steps have data, proceed to outline
				return {
					step: 'outline',
					message: 'Generating outline now.',
					shouldRunAgent: true,
				};
			}
		}
	};

	const nextStep = determineNextStep();
	stateUpdates.currentStep = nextStep.step;

	// Set halt reason if needed
	if (nextStep.step === 'references') {
		stateUpdates.halt = { reason: 'await_references_selection' };
	} else if (nextStep.step === 'interlinking') {
		stateUpdates.halt = { reason: 'await_interlinking_selection' };
	} else {
		stateUpdates.halt = null; // Clear halt to allow graph to proceed
	}

	// Create assistant messages
	const assistantMessages: string[] = [baseMessage];
	if (nextStep.message && nextStep.message !== baseMessage) {
		assistantMessages.push(nextStep.message);
	}
	const assistantMessage = assistantMessages.join(' ');

	return {
		assistantMessage: assistantMessage,
		assistantMessages:
			assistantMessages.length > 1 ? assistantMessages : undefined,
		stateUpdates,
		shouldRunAgent: nextStep.shouldRunAgent,
	};
};

// Handler for refinement/modification
const handleRefinement = (
	userMessage: string,
	intent: UserIntent,
	currentState: AgentState
): ConversationResponse => {
	const extractedData = intent.extractedData || {};

	// Check for explicit topic change via regex (fallback) or intent data
	const regexTopic = extractTopicFromMessage(userMessage);
	const newTopic =
		extractedData.topic || (regexTopic.length > 3 ? regexTopic : null);

	// Check for other field updates
	const newPrimaryKeyword = extractedData.primaryKeyword;
	const newSecondaryKeywords = extractedData.secondaryKeywords;
	const newTitle = extractedData.title;

	// ✨ NEW: Map fields to steps for bidirectional navigation
	const fieldToStepMap: Record<
		string,
		'topic' | 'primary_keyword' | 'secondary_keywords' | 'title'
	> = {
		topic: 'topic',
		primaryKeyword: 'primary_keyword',
		secondaryKeywords: 'secondary_keywords',
		title: 'title',
	};

	// ✨ NEW: Helper to clear dependent fields based on modification
	const clearDependentFields = (
		modifiedField: string
	): Partial<AgentState> => {
		const clearMap: Record<string, Partial<AgentState>> = {
			topic: {
				data: {
					topic: extractedData.topic,
					targetLocation:
						currentState.data.targetLocation ||
						'United States',
					primaryKeyword: undefined,
					secondaryKeywords: [],
					title: undefined,
				} as any,
				outline: [],
				outlineApproved: false,
				draft: '',
				progress: { sectionIndex: 0 },
			},
			primaryKeyword: {
				data: {
					...currentState.data,
					primaryKeyword: extractedData.primaryKeyword,
					secondaryKeywords: [],
					title: undefined,
				} as any,
				outline: [],
				outlineApproved: false,
			},
			secondaryKeywords: {
				data: {
					...currentState.data,
					secondaryKeywords:
						extractedData.secondaryKeywords,
					title: undefined,
				} as any,
				outline: [],
				outlineApproved: false,
			},
			title: {
				data: {
					...currentState.data,
					title: extractedData.title,
				} as any,
				outline: [],
				outlineApproved: false,
			},
		};
		return clearMap[modifiedField] || {};
	};

	// 1. Handle Topic Change (Major Reset)
	if (newTopic) {
		console.log(
			`🔄 [REFINEMENT] Topic change detected: "${newTopic}". Resetting flow.`
		);
		return {
			assistantMessage: `✅ **Topic updated!**\n\nI've set your blog topic to "${newTopic}". I'll restart the process with this new topic.`,
			stateUpdates: {
				...clearDependentFields('topic'),
				currentStep: 'topic', // ✨ Jump to topic step
				userProvidedFields: new Set(['topic']),
				autoFillFields: new Set(),
				halt: null,
			},
			shouldRunAgent: true,
		};
	}

	// 2. Handle Primary Keyword Update
	if (newPrimaryKeyword) {
		console.log(
			`🔄 [REFINEMENT] Primary keyword change: "${newPrimaryKeyword}"`
		);
		return {
			assistantMessage: `✅ **Primary keyword updated!**\n\nI've set your primary keyword to "${newPrimaryKeyword}". I'll now research secondary keywords that complement it.`,
			stateUpdates: {
				...clearDependentFields('primaryKeyword'),
				currentStep: 'primary_keyword', // ✨ Jump to primary keyword step
				userProvidedFields: new Set([
					...currentState.userProvidedFields,
					'primaryKeyword',
				]),
				halt: null,
			},
			shouldRunAgent: true,
		};
	}

	// 3. Handle Secondary Keywords Update
	if (newSecondaryKeywords) {
		console.log(`🔄 [REFINEMENT] Secondary keywords update`);
		return {
			assistantMessage: `✅ **Secondary keywords updated!**\n\nI've updated your secondary keywords. I'll now generate title options that incorporate these keywords.`,
			stateUpdates: {
				...clearDependentFields('secondaryKeywords'),
				currentStep: 'secondary_keywords', // ✨ Jump to secondary keywords step
				userProvidedFields: new Set([
					...currentState.userProvidedFields,
					'secondaryKeywords',
				]),
				halt: null,
			},
			shouldRunAgent: true,
		};
	}

	// 4. Handle Title Update
	// BUT: If user is asking for options/suggestions, don't set the title directly
	const isAskingForOptions =
		/(?:options|suggestions|what are|give me|show me|best|good)/i.test(
			userMessage
		);

	if (newTitle && !isAskingForOptions) {
		console.log(`🔄 [REFINEMENT] Title change: "${newTitle}"`);
		return {
			assistantMessage: `✅ **Title updated!**\n\nI've set your blog title to "${newTitle}". Ready to proceed with outline generation.`,
			stateUpdates: {
				...clearDependentFields('title'),
				currentStep: 'title', // ✨ Jump to title step
				userProvidedFields: new Set([
					...currentState.userProvidedFields,
					'title',
				]),
				halt: null,
			},
			shouldRunAgent: true,
		};
	}

	// 5. Handle request to modify without providing new value (e.g., "I want to change the title")
	const modificationRequest = detectModificationRequest(userMessage);
	if (modificationRequest) {
		const targetStep = fieldToStepMap[modificationRequest];
		console.log(
			`🔄 [REFINEMENT] User wants to modify ${modificationRequest}, jumping to ${targetStep}`
		);

		// Clear the field being modified so the router will trigger the appropriate node
		const stateUpdates: Partial<AgentState> = {
			currentStep: targetStep,
			halt: null,
		};

		// Clear the specific field to trigger regeneration
		if (modificationRequest === 'title') {
			stateUpdates.data = {
				...currentState.data,
				title: undefined,
			} as any;
			stateUpdates.outline = []; // Clear outline since it depends on title
			stateUpdates.outlineApproved = false;
		} else if (modificationRequest === 'primaryKeyword') {
			stateUpdates.data = {
				...currentState.data,
				primaryKeyword: undefined,
				secondaryKeywords: [],
				title: undefined,
			} as any;
			stateUpdates.outline = [];
			stateUpdates.outlineApproved = false;
		} else if (modificationRequest === 'secondaryKeywords') {
			stateUpdates.data = {
				...currentState.data,
				secondaryKeywords: [],
				title: undefined,
			} as any;
			stateUpdates.outline = [];
			stateUpdates.outlineApproved = false;
		} else if (modificationRequest === 'topic') {
			stateUpdates.data = {
				...currentState.data,
				topic: undefined,
				primaryKeyword: undefined,
				secondaryKeywords: [],
				title: undefined,
			} as any;
			stateUpdates.outline = [];
			stateUpdates.outlineApproved = false;
		}

		return {
			assistantMessage: `✅ **Generating new options...**\n\nI'll show you fresh options for ${modificationRequest}. Please wait a moment while I research and generate them.`,
			stateUpdates,
			shouldRunAgent: true,
		};
	}

	return {
		assistantMessage:
			"I'll help you refine the content. What specifically would you like to improve?",
		stateUpdates: {},
		shouldRunAgent: false,
	};
};

// ✨ NEW: Helper to detect modification requests without new values
const detectModificationRequest = (message: string): string | null => {
	const patterns: Record<string, RegExp[]> = {
		title: [
			/(?:change|modify|update|edit)\s+(?:the\s+)?title/i,
			/(?:want|need)\s+(?:a\s+)?(?:new|different)\s+title/i,
			/give\s+me\s+(?:new\s+)?title\s+options/i,
			/(?:title|titles)\s+(?:options|suggestions)/i,
			/what\s+are\s+(?:the\s+)?(?:best|good).*?title/i,
		],
		primaryKeyword: [
			/(?:change|modify|update)\s+(?:the\s+)?(?:primary\s+)?keyword/i,
			/(?:want|need)\s+(?:a\s+)?(?:new|different)\s+keyword/i,
		],
		secondaryKeywords: [
			/(?:change|modify|update)\s+(?:the\s+)?secondary\s+keywords/i,
			/(?:want|need)\s+(?:new|different)\s+secondary\s+keywords/i,
		],
		topic: [
			/(?:change|modify|update)\s+(?:the\s+)?topic/i,
			/(?:want|need)\s+(?:a\s+)?(?:new|different)\s+topic/i,
		],
	};

	for (const [field, regexList] of Object.entries(patterns)) {
		for (const regex of regexList) {
			if (regex.test(message)) {
				return field;
			}
		}
	}

	return null;
};

// Handler for approval
const handleApproval = (currentState: AgentState): ConversationResponse => {
	// Check what step we're approving
	const currentStep = currentState.currentStep;

	if (
		currentStep === 'outline_confirmation' ||
		currentState.halt?.reason === 'await_outline_start_confirmation'
	) {
		// User approved outline generation
		return {
			assistantMessage:
				"📋 **Generating your blog outline...**\n\nI'm creating a comprehensive outline that structures your content logically and covers all key points based on your topic and keywords.",
			stateUpdates: {
				currentStep: 'outline',
				halt: null,
			},
			shouldRunAgent: true,
		};
	}

	if (currentState.halt?.reason === 'awaiting_approval') {
		// User approved the outline
		return {
			assistantMessage:
				"✍️ **Starting blog generation...**\n\nI'll now create your blog post section by section, incorporating all your keywords and following the approved outline.",
			stateUpdates: {
				outlineApproved: true,
				halt: null,
			},
			shouldRunAgent: true,
		};
	}

	// Handle references step approval
	if (
		currentStep === 'references' ||
		currentState.halt?.reason === 'await_references_selection'
	) {
		// Check if we should move to interlinking or outline
		if (
			!currentState.data.interlinks ||
			currentState.data.interlinks.length === 0
		) {
			// Move to interlinking step
			return {
				assistantMessage:
					'Great! Please add any internal links to your existing content (optional).',
				stateUpdates: {
					currentStep: 'interlinking',
					halt: { reason: 'await_interlinking_selection' },
				},
				shouldRunAgent: false,
			};
		} else {
			// Both optional steps have data, proceed to outline
			return {
				assistantMessage:
					"📋 **Generating your blog outline...**\n\nI'm creating a comprehensive outline that structures your content logically and covers all key points based on your topic and keywords.",
				stateUpdates: {
					currentStep: 'outline',
					halt: null,
				},
				shouldRunAgent: true,
			};
		}
	}

	// Handle interlinking step approval
	if (
		currentStep === 'interlinking' ||
		currentState.halt?.reason === 'await_interlinking_selection'
	) {
		// Move to outline generation
		return {
			assistantMessage:
				"📋 **Generating your blog outline...**\n\nI'm creating a comprehensive outline that structures your content logically and covers all key points based on your topic and keywords.",
			stateUpdates: {
				currentStep: 'outline',
				halt: null,
			},
			shouldRunAgent: true,
		};
	}

	// Default approval
	return {
		assistantMessage: '✅ **Proceeding to next step...**',
		stateUpdates: {
			halt: null,
		},
		shouldRunAgent: true,
	};
};

// Handler for skip_step
const handleSkipStep = (currentState: AgentState): ConversationResponse => {
	const currentStep = currentState.currentStep;

	if (currentStep === 'references') {
		// User skipped references, move to interlinking
		return {
			assistantMessage:
				'Skipped. Please add any internal links to your existing content (optional).',
			stateUpdates: {
				currentStep: 'interlinking',
				halt: { reason: 'await_interlinking_selection' },
			},
			shouldRunAgent: false,
		};
	}

	if (currentStep === 'interlinking') {
		// User skipped interlinking, move to outline generation
		return {
			assistantMessage: 'Skipped. Generating your outline now...',
			stateUpdates: {
				currentStep: 'outline',
				halt: null,
			},
			shouldRunAgent: true,
		};
	}

	// Default skip
	return {
		assistantMessage: 'Skipping this step...',
		stateUpdates: {
			halt: null,
		},
		shouldRunAgent: true,
	};
};

// Extract topic from user message
const extractTopicFromMessage = (message: string): string => {
	const patterns = [
		// Only match when "topic" is explicitly mentioned
		/(?:change|update|modify|switch).*?topic.*?(?:to|:)\s+(.+?)(?:\.|,|$)/i,
		/topic.*?(?:to|:)\s+(.+?)(?:\.|,|$)/i,
		// Match "write about X" or "blog about X" only if not talking about title
		/(?:blog|write).*?(?:about|on)\s+(.+?)(?:\.|,|$)/i,
	];

	// Don't extract if the message is clearly about title, not topic
	if (/(?:change|modify|update).*?title/i.test(message)) {
		return '';
	}

	for (const pattern of patterns) {
		const match = message.match(pattern);
		if (match) {
			return match[1].trim();
		}
	}

	return '';
};
