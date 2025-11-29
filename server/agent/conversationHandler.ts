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

	// ✨ CRITICAL: Check for pending modification confirmation FIRST
	// This must happen before intent classification to handle confirmations properly
	const pendingModification = (currentState as any)
		.pendingModificationRequest;

	if (pendingModification) {
		// Check if user is confirming (yes, proceed, ok, etc.)
		const isConfirming =
			/^(yes|yep|ok|okay|proceed|continue|sure|go ahead|do it|confirm)$/i.test(
				userMessage.trim()
			);
		// Check if user is canceling (no, cancel, etc.)
		const isCanceling =
			/^(no|nope|cancel|abort|stop|nevermind|forget it|don't)$/i.test(
				userMessage.trim()
			);

		if (isConfirming) {
			// User confirmed - proceed with modification
			const fieldToStepMap: Record<
				string,
				| 'topic'
				| 'primary_keyword'
				| 'secondary_keywords'
				| 'title'
			> = {
				topic: 'topic',
				primaryKeyword: 'primary_keyword',
				secondaryKeywords: 'secondary_keywords',
				title: 'title',
			};

			const targetStep = fieldToStepMap[pendingModification];
			const stateUpdates: Partial<AgentState> = {
				currentStep: targetStep,
				halt: null,
				pendingModificationRequest: undefined,
			} as any;

			// Clear the specific field to trigger regeneration
			if (pendingModification === 'title') {
				stateUpdates.data = {
					...currentState.data,
					title: undefined,
				} as any;
				stateUpdates.outline = [];
				stateUpdates.outlineApproved = false;
			} else if (pendingModification === 'primaryKeyword') {
				stateUpdates.data = {
					...currentState.data,
					primaryKeyword: undefined,
					secondaryKeywords: [],
					title: undefined,
				} as any;
				stateUpdates.outline = [];
				stateUpdates.outlineApproved = false;
			} else if (pendingModification === 'secondaryKeywords') {
				stateUpdates.data = {
					...currentState.data,
					secondaryKeywords: [],
					title: undefined,
				} as any;
				stateUpdates.outline = [];
				stateUpdates.outlineApproved = false;
			} else if (pendingModification === 'topic') {
				stateUpdates.data = {
					...currentState.data,
					topic: undefined,
					primaryKeyword: undefined,
					secondaryKeywords: [],
					title: undefined,
				} as any;
				stateUpdates.outline = [];
				stateUpdates.outlineApproved = false;
				stateUpdates.draft = '';
				stateUpdates.progress = { sectionIndex: 0 };
			}

			return {
				assistantMessage: `Understood! I'll update the ${pendingModification} and regenerate the necessary steps.`,
				stateUpdates,
				shouldRunAgent: true,
			};
		} else if (isCanceling) {
			// User canceled - clear pending modification
			return {
				assistantMessage:
					"No problem! I'll keep everything as is. What would you like to do instead?",
				stateUpdates: {
					pendingModificationRequest: undefined,
				} as any,
				shouldRunAgent: false,
			};
		} else {
			// User said something else while there's a pending modification
			// Remind them about the pending confirmation
			const getStepsToRedo = (field: string): string[] => {
				const stepsMap: Record<string, string[]> = {
					topic: [
						'primary keyword research',
						'secondary keyword research',
						'title generation',
						'outline generation',
						'content generation',
					],
					primaryKeyword: [
						'secondary keyword research',
						'title generation',
						'outline generation',
						'content generation',
					],
					secondaryKeywords: [
						'title generation',
						'outline generation',
						'content generation',
					],
					title: [
						'outline generation',
						'content generation',
					],
				};
				return stepsMap[field] || [];
			};
			const stepsToRedo = getStepsToRedo(pendingModification);
			return {
				assistantMessage: `⚠️ **Pending Confirmation**\n\nYou have a pending request to change the ${pendingModification}. This will require redoing:\n${stepsToRedo
					.map((s) => `- ${s}`)
					.join(
						'\n'
					)}\n\n**Please confirm:** Type "yes" to proceed or "no" to cancel.`,
				stateUpdates: {},
				shouldRunAgent: false,
			};
		}
	}

	// Step 1: Classify intent (only if no pending modification)
	const intent: UserIntent = await classifyIntent(
		userMessage,
		currentState,
		apiKey
	);

	console.log(`🎯 [INTENT CLASSIFIED] Type: ${intent.type}`);

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

// ✨ NEW: Helper to identify missing required information
const getMissingInformation = (state: AgentState): string[] => {
	const missing: string[] = [];

	if (!state.data.topic?.trim()) {
		missing.push('topic');
	}
	if (!state.data.primaryKeyword?.trim()) {
		missing.push('primary keyword');
	}
	if (
		!state.data.secondaryKeywords ||
		state.data.secondaryKeywords.length === 0
	) {
		missing.push('secondary keywords');
	}
	if (!state.data.title?.trim()) {
		missing.push('title');
	}

	return missing;
};

// ✨ NEW: Helper to get current step in sequence
const getCurrentRequiredStep = (state: AgentState): string | null => {
	if (!state.data.topic?.trim()) return 'topic';
	if (!state.data.primaryKeyword?.trim()) return 'primary keyword';
	if (
		!state.data.secondaryKeywords ||
		state.data.secondaryKeywords.length === 0
	)
		return 'secondary keywords';
	if (!state.data.title?.trim()) return 'title';
	return null; // All required info collected
};

// ✨ NEW: Helper to validate provided information
const validateInformation = (
	extractedData: Partial<BlogData>
): { valid: boolean; issues: string[] } => {
	const issues: string[] = [];

	if (extractedData.topic && extractedData.topic.trim().length < 3) {
		issues.push('Topic is too short (minimum 3 characters)');
	}
	if (
		extractedData.primaryKeyword &&
		extractedData.primaryKeyword.trim().length < 2
	) {
		issues.push('Primary keyword is too short (minimum 2 characters)');
	}
	if (
		extractedData.secondaryKeywords &&
		extractedData.secondaryKeywords.length > 0
	) {
		const invalidKeywords = extractedData.secondaryKeywords.filter(
			(kw) => !kw || kw.trim().length < 2
		);
		if (invalidKeywords.length > 0) {
			issues.push(
				'Some secondary keywords are too short or invalid'
			);
		}
	}
	if (extractedData.title && extractedData.title.trim().length < 5) {
		issues.push('Title is too short (minimum 5 characters)');
	}

	return {
		valid: issues.length === 0,
		issues,
	};
};

// Handler for greetings
const handleGreeting = (currentState: AgentState): ConversationResponse => {
	if (hasStartedBlogCreation(currentState)) {
		// User has started - check what's missing and guide them
		const missing = getMissingInformation(currentState);
		const currentStep = getCurrentRequiredStep(currentState);

		if (missing.length > 0) {
			let message = `Hello! 👋 Nice to hear from you again!\\n\\n`;
			message += `To continue with your blog, I need the following information:\\n\\n`;
			missing.forEach((item, index) => {
				message += `${index + 1}. ${
					item.charAt(0).toUpperCase() + item.slice(1)
				}\\n`;
			});
			message += `\\n**What would you like to provide next?**`;

			return {
				assistantMessage: message,
				stateUpdates: {},
				shouldRunAgent: false,
			};
		}

		return {
			assistantMessage: `Hello! 👋 Nice to hear from you again!\\n\\nLet's continue with your blog.`,
			stateUpdates: {},
			shouldRunAgent: false,
		};
	}

	// ✨ NEW: Initial greeting asks for ALL required information
	return {
		assistantMessage:
			"Hello! 👋 I'm your Blog Agent. I'll help you create an SEO-optimized blog post!\\n\\n" +
			"**To get started, I'll need the following information:**\\n\\n" +
			'1. **Topic** - What would you like to write about?\\n' +
			'2. **Primary Keyword** - Main SEO keyword for your blog\\n' +
			'3. **Secondary Keywords** - Additional keywords (up to 5)\\n' +
			'4. **Title** - Blog post title\\n' +
			'5. **Reference URLs** (Optional) - Links for research\\n' +
			'6. **Internal Links** (Optional) - Links to your existing content\\n\\n' +
			'**You can:**\\n' +
			'- Provide all information at once, or\\n' +
			'- Say **"generate blog automatically"** to let me handle everything!\\n\\n' +
			"**What's your blog topic?**",
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
	// ✨ NEW: Redirect user back to blog creation and ask for missing info
	const missing = getMissingInformation(currentState);
	const currentStep = getCurrentRequiredStep(currentState);

	if (missing.length > 0) {
		let message =
			"I'm specifically designed to help you create blog content! 📝\\n\\n";
		message += "**Let's stay focused on blog creation.**\\n\\n";

		if (currentStep) {
			message += `**I need your ${currentStep} to continue.**\\n\\n`;
			if (currentStep === 'topic') {
				message += 'What topic would you like to write about?';
			} else if (currentStep === 'primary keyword') {
				message += 'What primary keyword should I use for SEO?';
			} else if (currentStep === 'secondary keywords') {
				message +=
					'What secondary keywords should I include? (comma-separated)';
			} else if (currentStep === 'title') {
				message +=
					'What title would you like for your blog post?';
			}
		} else {
			message += '**Missing information:**\\n';
			missing.forEach((item, index) => {
				message += `${index + 1}. ${
					item.charAt(0).toUpperCase() + item.slice(1)
				}\\n`;
			});
			message += '\\n**What would you like to provide?**';
		}

		return {
			assistantMessage: message,
			stateUpdates: {},
			shouldRunAgent: false,
		};
	}

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
	userMessage: string,
	intent: UserIntent,
	currentState: AgentState
): ConversationResponse => {
	const extractedData = intent.extractedData || {};

	// ✨ NEW: Validate information first
	const validation = validateInformation(extractedData);
	if (!validation.valid) {
		let message = '⚠️ **Validation Issues:**\\n\\n';
		validation.issues.forEach((issue) => {
			message += `- ${issue}\\n`;
		});
		message += '\\n**Please provide valid information.**';
		return {
			assistantMessage: message,
			stateUpdates: {},
			shouldRunAgent: false,
		};
	}

	// ✨ Check if user is providing data that would modify existing fields
	// If so, check if we need confirmation
	const pendingModification = (currentState as any)
		.pendingModificationRequest;

	// If there's a pending modification and user is providing new data,
	// treat it as a confirmation with the new value
	if (
		pendingModification &&
		(extractedData[pendingModification] || extractedData.topic)
	) {
		// User provided new value - treat as confirmation
		const fieldToStepMap: Record<
			string,
			'topic' | 'primary_keyword' | 'secondary_keywords' | 'title'
		> = {
			topic: 'topic',
			primaryKeyword: 'primary_keyword',
			secondaryKeywords: 'secondary_keywords',
			title: 'title',
		};

		const targetStep = fieldToStepMap[pendingModification];
		const stateUpdates: Partial<AgentState> = {
			currentStep: targetStep,
			halt: null,
			pendingModificationRequest: undefined,
		} as any;

		// Update with new data and clear dependent fields
		if (pendingModification === 'title' && extractedData.title) {
			stateUpdates.data = {
				...currentState.data,
				title: extractedData.title,
			} as any;
			stateUpdates.outline = [];
			stateUpdates.outlineApproved = false;
		} else if (
			pendingModification === 'primaryKeyword' &&
			extractedData.primaryKeyword
		) {
			stateUpdates.data = {
				...currentState.data,
				primaryKeyword: extractedData.primaryKeyword,
				secondaryKeywords: [],
				title: undefined,
			} as any;
			stateUpdates.outline = [];
			stateUpdates.outlineApproved = false;
		} else if (
			pendingModification === 'secondaryKeywords' &&
			extractedData.secondaryKeywords
		) {
			stateUpdates.data = {
				...currentState.data,
				secondaryKeywords: extractedData.secondaryKeywords,
				title: undefined,
			} as any;
			stateUpdates.outline = [];
			stateUpdates.outlineApproved = false;
		} else if (
			pendingModification === 'topic' &&
			(extractedData.topic || extractedData.topic)
		) {
			stateUpdates.data = {
				topic: extractedData.topic,
				targetLocation:
					currentState.data.targetLocation ||
					'United States',
				primaryKeyword: undefined,
				secondaryKeywords: [],
				title: undefined,
			} as any;
			stateUpdates.outline = [];
			stateUpdates.outlineApproved = false;
			stateUpdates.draft = '';
			stateUpdates.progress = { sectionIndex: 0 };
		}

		return {
			assistantMessage: `Got it! I've updated the ${pendingModification} and will regenerate the necessary steps.`,
			stateUpdates,
			shouldRunAgent: true,
		};
	}

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

	// ✨ NEW: Analyze what was provided and what's missing
	const missing = getMissingInformation({
		...currentState,
		data: updatedData,
	} as AgentState);
	const currentStep = getCurrentRequiredStep({
		...currentState,
		data: updatedData,
	} as AgentState);

	// ✨ NEW: Detect if user wants to generate blog but hasn't provided topic
	// More flexible pattern to catch variations
	const wantsToGenerateBlog =
		/(?:want|wanna|would like|need|going|plan|intend|trying) to (?:generate|create|write|make|build|get).*(?:blog|article|post|content)/i.test(
			userMessage
		) ||
		/(?:generate|create|write|make|build).*(?:blog|article|post)/i.test(
			userMessage
		);
	const hasNoTopic = !extractedData.topic && !currentState.data.topic;
	const hasNoData = capturedItems.length === 0;

	let assistantMessage = '';

	// ✨ NEW: Friendly response when user wants to generate blog but no topic provided
	if (wantsToGenerateBlog && hasNoTopic && hasNoData) {
		assistantMessage = `Sure! I'd be happy to help you generate a blog! 📝\\n\\n`;
		assistantMessage += `**To get started, I'll need to know what topic you'd like to write about.**\\n\\n`;
		assistantMessage += `For example:\\n`;
		assistantMessage += `- "AI in healthcare"\\n`;
		assistantMessage += `- "Remote work best practices"\\n`;
		assistantMessage += `- "Sustainable living tips"\\n\\n`;
		assistantMessage += `**What topic would you like to write about?**`;
	} else if (capturedItems.length > 0) {
		assistantMessage = `✅ **Information Received:** ${capturedItems.join(
			', '
		)}\\n\\n`;
	} else {
		// ✨ IMPROVED: Better default message when no data provided
		if (hasNoTopic) {
			assistantMessage = `Sure! Let me help you create a blog. 📝\\n\\n`;
			assistantMessage += `**What topic would you like to write about?**`;
		} else {
			assistantMessage = `Got it! Ready to proceed.\\n\\n`;
		}
	}

	// ✨ NEW: Identify missing information and ask for suggestions
	if (
		missing.length > 0 &&
		!(wantsToGenerateBlog && hasNoTopic && capturedItems.length === 0)
	) {
		assistantMessage += `**Missing Information:**\\n`;
		missing.forEach((item, index) => {
			assistantMessage += `${index + 1}. ${
				item.charAt(0).toUpperCase() + item.slice(1)
			}\\n`;
		});
		assistantMessage += `\\n`;

		// Suggest next step
		if (currentStep === 'topic') {
			assistantMessage += `**Next Step:** Please provide your blog topic.`;
		} else if (currentStep === 'primary keyword') {
			assistantMessage += `**Next Step:** I can research keywords for you, or you can provide a primary keyword.`;
		} else if (currentStep === 'secondary keywords') {
			assistantMessage += `**Next Step:** I can suggest secondary keywords, or you can provide them (comma-separated).`;
		} else if (currentStep === 'title') {
			assistantMessage += `**Next Step:** I can generate title options for you, or you can provide a title.`;
		} else {
			assistantMessage += `**What would you like to provide next?**`;
		}
	} else if (
		missing.length === 0 &&
		!(wantsToGenerateBlog && hasNoTopic && capturedItems.length === 0)
	) {
		assistantMessage += `✅ All required information collected! Let me proceed with blog generation.`;
	}

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

	// ✨ CRITICAL: Don't run agent if we're asking for topic
	if (wantsToGenerateBlog && hasNoTopic && hasNoData) {
		stateUpdates.currentStep = 'topic';
		return {
			assistantMessage: assistantMessage,
			stateUpdates,
			shouldRunAgent: false,
		};
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

	// Helper to get steps that will be redone
	const getStepsToRedo = (field: string): string[] => {
		const stepsMap: Record<string, string[]> = {
			topic: [
				'primary keyword research',
				'secondary keyword research',
				'title generation',
				'outline generation',
				'content generation',
			],
			primaryKeyword: [
				'secondary keyword research',
				'title generation',
				'outline generation',
				'content generation',
			],
			secondaryKeywords: [
				'title generation',
				'outline generation',
				'content generation',
			],
			title: ['outline generation', 'content generation'],
		};
		return stepsMap[field] || [];
	};

	// 1. Handle Topic Change (Major Reset)
	// ✨ Always ask for confirmation if topic already exists
	if (newTopic) {
		console.log(
			`🔄 [REFINEMENT] Topic change detected: "${newTopic}". Resetting flow.`
		);
		const topicExists = !!currentState.data.topic;
		const topicChanged =
			topicExists &&
			newTopic.toLowerCase().trim() !==
				currentState.data.topic?.toLowerCase().trim();

		// Ask for confirmation if topic exists or if it's different
		if (topicExists || topicChanged) {
			const stepsToRedo = getStepsToRedo('topic');
			return {
				assistantMessage: `⚠️ **Important Notice**\n\nChanging the topic will require redoing the following steps:\n${stepsToRedo
					.map((s) => `- ${s}`)
					.join(
						'\n'
					)}\n\n**Do you want to proceed?** (Type "yes" to continue or "no" to cancel)`,
				stateUpdates: {
					pendingModificationRequest: 'topic',
				} as any,
				shouldRunAgent: false,
			};
		}
	}

	// 2. Handle Primary Keyword Update
	// ✨ Always ask for confirmation if primary keyword already exists
	if (newPrimaryKeyword) {
		console.log(
			`🔄 [REFINEMENT] Primary keyword change: "${newPrimaryKeyword}"`
		);
		const keywordExists = !!currentState.data.primaryKeyword;
		const keywordChanged =
			keywordExists &&
			newPrimaryKeyword.toLowerCase().trim() !==
				currentState.data.primaryKeyword?.toLowerCase().trim();

		// Ask for confirmation if keyword exists or if it's different
		if (keywordExists || keywordChanged) {
			const stepsToRedo = getStepsToRedo('primaryKeyword');
			return {
				assistantMessage: `⚠️ **Important Notice**\n\nChanging the primary keyword will require redoing the following steps:\n${stepsToRedo
					.map((s) => `- ${s}`)
					.join(
						'\n'
					)}\n\n**Do you want to proceed?** (Type "yes" to continue or "no" to cancel)`,
				stateUpdates: {
					pendingModificationRequest: 'primaryKeyword',
				} as any,
				shouldRunAgent: false,
			};
		}
	}

	// 3. Handle Secondary Keywords Update
	// ✨ Always ask for confirmation if secondary keywords already exist
	if (newSecondaryKeywords && newSecondaryKeywords.length > 0) {
		console.log(`🔄 [REFINEMENT] Secondary keywords update`);
		const keywordsExist =
			(currentState.data.secondaryKeywords?.length || 0) > 0;
		const keywordsChanged =
			keywordsExist &&
			JSON.stringify(
				newSecondaryKeywords
					.map((k) => k.toLowerCase().trim())
					.sort()
			) !==
				JSON.stringify(
					(currentState.data.secondaryKeywords || [])
						.map((k) => k.toLowerCase().trim())
						.sort()
				);

		// Ask for confirmation if keywords exist or if they're different
		if (keywordsExist || keywordsChanged) {
			const stepsToRedo = getStepsToRedo('secondaryKeywords');
			return {
				assistantMessage: `⚠️ **Important Notice**\n\nChanging the secondary keywords will require redoing the following steps:\n${stepsToRedo
					.map((s) => `- ${s}`)
					.join(
						'\n'
					)}\n\n**Do you want to proceed?** (Type "yes" to continue or "no" to cancel)`,
				stateUpdates: {
					pendingModificationRequest: 'secondaryKeywords',
				} as any,
				shouldRunAgent: false,
			};
		}
	}

	// 4. Handle Title Update
	// BUT: If user is asking for options/suggestions, don't set the title directly
	const isAskingForOptions =
		/(?:options|suggestions|what are|give me|show me|best|good)/i.test(
			userMessage
		);

	if (newTitle && !isAskingForOptions) {
		console.log(`🔄 [REFINEMENT] Title change: "${newTitle}"`);
		const titleExists = !!currentState.data.title;
		const titleChanged =
			titleExists &&
			newTitle.toLowerCase().trim() !==
				currentState.data.title?.toLowerCase().trim();

		// Ask for confirmation if title exists or if it's different
		if (titleExists || titleChanged) {
			const stepsToRedo = getStepsToRedo('title');
			return {
				assistantMessage: `⚠️ **Important Notice**\n\nChanging the title will require redoing the following steps:\n${stepsToRedo
					.map((s) => `- ${s}`)
					.join(
						'\n'
					)}\n\n**Do you want to proceed?** (Type "yes" to continue or "no" to cancel)`,
				stateUpdates: {
					pendingModificationRequest: 'title',
				} as any,
				shouldRunAgent: false,
			};
		}
	}

	// 5. Handle request to modify without providing new value (e.g., "I want to change the title")
	const modificationRequest = detectModificationRequest(userMessage);
	if (modificationRequest) {
		console.log(
			`🔄 [REFINEMENT] User wants to modify ${modificationRequest}`
		);

		// ✨ ALWAYS ask for confirmation if the field already exists
		// Check if the field being modified already has a value
		const fieldExists =
			(modificationRequest === 'topic' &&
				currentState.data.topic) ||
			(modificationRequest === 'primaryKeyword' &&
				currentState.data.primaryKeyword) ||
			(modificationRequest === 'secondaryKeywords' &&
				currentState.data.secondaryKeywords?.length > 0) ||
			(modificationRequest === 'title' && currentState.data.title);

		// Check if there's already progress that will be lost
		const hasProgress =
			(modificationRequest === 'topic' &&
				(currentState.data.primaryKeyword ||
					currentState.outline?.length > 0 ||
					currentState.draft)) ||
			(modificationRequest === 'primaryKeyword' &&
				(currentState.data.secondaryKeywords?.length > 0 ||
					currentState.outline?.length > 0 ||
					currentState.draft)) ||
			(modificationRequest === 'secondaryKeywords' &&
				(currentState.data.title ||
					currentState.outline?.length > 0 ||
					currentState.draft)) ||
			(modificationRequest === 'title' &&
				(currentState.outline?.length > 0 ||
					currentState.draft));

		// Ask for confirmation if field exists OR if there's progress to lose
		if (fieldExists || hasProgress) {
			const stepsToRedo = getStepsToRedo(modificationRequest);
			return {
				assistantMessage: `⚠️ **Important Notice**\n\nChanging the ${modificationRequest} will require redoing the following steps:\n${stepsToRedo
					.map((s) => `- ${s}`)
					.join(
						'\n'
					)}\n\n**Do you want to proceed?** (Type "yes" to continue or "no" to cancel)`,
				stateUpdates: {
					pendingModificationRequest: modificationRequest,
				} as any,
				shouldRunAgent: false,
			};
		}

		// No existing field and no progress to lose, proceed directly
		const targetStep = fieldToStepMap[modificationRequest];
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

	// ✨ NEW: Handle auto-selection confirmation
	if (currentState.halt?.reason === 'await_auto_selection_confirmation') {
		// User approved auto-selection - proceed to next step
		return {
			assistantMessage:
				'Great! Proceeding with the selected value...',
			stateUpdates: {
				halt: null,
			},
			shouldRunAgent: true,
		};
	}

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
