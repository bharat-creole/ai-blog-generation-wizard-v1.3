/**
 * Backend Conversation Handler - Processes user messages and manages conversation state
 * This is the main orchestrator that determines intent and handles modifications
 */

import { AgentState } from './state';
import { classifyIntent, UserIntent } from './intentClassifier';
import { BlogData } from '../../types';
import * as automationEngine from '../../services/automationEngine';

export interface ConversationResponse {
	assistantMessage: string;
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
	console.log(`   primaryKeyword: ${currentState.data?.primaryKeyword || 'none'}`);
	console.log(`   title: ${currentState.data?.title || 'none'}`);
	console.log(`   hasOutline: ${currentState.outline?.length > 0 ? 'yes' : 'no'}`);
	console.log(`   outlineApproved: ${currentState.outlineApproved || false}`);
	console.log(`   halt: ${currentState.halt?.reason || 'none'}`);
	console.log(`   automationLevel: ${currentState.preferences?.automationLevel || 'none'}`);

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
			secondaryKeywords: intent.extractedData.secondaryKeywords?.length || 0,
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
const handleOffTopic = (_currentState: AgentState): ConversationResponse => {
	return {
		assistantMessage:
			"I'm specifically designed to help you create blog content! 📝\\n\\nTell me what blog topic you'd like to write about.",
		stateUpdates: {},
		shouldRunAgent: false,
	};
};

// Handler for full automation
const handleFullAutomation = (
	_userMessage: string,
	intent: UserIntent,
	currentState: AgentState
): ConversationResponse => {
	const extractedData = intent.extractedData || {};
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
	_userMessage: string,
	intent: UserIntent,
	currentState: AgentState
): ConversationResponse => {
	const extractedData = intent.extractedData || {};
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

	let assistantMessage =
		capturedItems.length > 0
			? `Got it! I've captured: ${capturedItems.join(', ')}.`
			: `Got it! Ready to proceed.`;

	// ✨ CRITICAL: Reset flags if critical fields changed
	const criticalFieldsUpdated =
		(extractedData.topic &&
			extractedData.topic !== currentState.data.topic) ||
		(extractedData.primaryKeyword &&
			extractedData.primaryKeyword !==
			currentState.data.primaryKeyword);

	const stateUpdates: Partial<AgentState> = {
		data: updatedData as BlogData,
		userProvidedFields: new Set(Object.keys(extractedData)),
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

	let shouldRunAgent = true; // Default to true, then override if specific conditions require a halt

	// ✨ FIX: Determine correct currentStep based on what was provided or confirmed
	if (extractedData.topic) {
		stateUpdates.currentStep = 'topic';
		assistantMessage += ` Let me research keywords for you.`;
	} else if (extractedData.primaryKeyword) {
		stateUpdates.currentStep = 'primary_keyword'; // Graph will move to secondary research
		assistantMessage += ` Moving on to secondary keyword research.`;
	} else if (extractedData.secondaryKeywords) {
		stateUpdates.currentStep = 'secondary_keywords'; // Will trigger title generation
		assistantMessage += ` Generating titles now.`;
		stateUpdates.halt = null; // Clear halt so graph can proceed
	} else if (extractedData.title) {
		stateUpdates.currentStep = 'title';
		stateUpdates.halt = null; // Clear halt to allow graph to run

		// After title is set, determine next step based on automation level
		if (currentState.preferences?.automationLevel === 'full') {
			// Full automation - skip optional steps and go straight to outline
			assistantMessage += ` Generating outline now.`;
			shouldRunAgent = true;
		} else {
			// Guided mode - prompt for optional steps
			// First check references
			if (
				!currentState.data.referenceUrls ||
				currentState.data.referenceUrls.length === 0
			) {
				stateUpdates.currentStep = 'references';
				stateUpdates.halt = {
					reason: 'await_references_selection',
				};
				assistantMessage += ` Please add any reference links for research (optional).`;
				shouldRunAgent = false;
			} else if (
				!currentState.data.interlinks ||
				currentState.data.interlinks.length === 0
			) {
				// References already provided, check interlinking
				stateUpdates.currentStep = 'interlinking';
				stateUpdates.halt = {
					reason: 'await_interlinking_selection',
				};
				assistantMessage += ` Please add any internal links to your existing content (optional).`;
				shouldRunAgent = false;
			} else {
				// Both optional steps have data, proceed to outline
				stateUpdates.currentStep = 'outline';
				stateUpdates.halt = null;
				assistantMessage += ` Generating outline now.`;
				shouldRunAgent = true;
			}
		}
	}
	// If none of the above, don't change currentStep

	return {
		assistantMessage: assistantMessage,
		stateUpdates,
		shouldRunAgent,
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
			assistantMessage: `Got it! I'll update the topic to "${newTopic}" and restart the process.`,
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
			assistantMessage: `Got it! I've updated the primary keyword to "${newPrimaryKeyword}".`,
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
			assistantMessage: `Got it! I've updated the secondary keywords.`,
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
			assistantMessage: `Got it! I've updated the title to "${newTitle}".`,
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
			assistantMessage: `Sure! Let me show you options for ${modificationRequest}.`,
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
			assistantMessage: 'Great! Generating your outline now...',
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
			assistantMessage: 'Great! Proceeding with blog generation...',
			stateUpdates: {
				outlineApproved: true,
				halt: null,
			},
			shouldRunAgent: true,
		};
	}

	// Default approval
	return {
		assistantMessage: 'Great! Proceeding...',
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
