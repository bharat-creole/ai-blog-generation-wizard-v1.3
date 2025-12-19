import { AgentState } from '../server/agent/state';
import { classifyIntent, UserIntent } from './agentIntentClassifier';
import { extractDataFromMessage } from './dataExtractor';
import { handleQuery } from './queryHandler';
import { BlogData } from '../types';

export interface ConversationResponse {
	assistantMessage: string;
	stateUpdates: Partial<AgentState>;
	shouldRunAgent: boolean;
	showProgress?: boolean;
}

export const processMessage = async (
	userMessage: string,
	currentState: AgentState,
	apiKey: string,
	userSelectedAutomationMode?: 'full' | 'guided' | 'manual'
): Promise<ConversationResponse> => {
	// 📥 LOG: Entry point - track ALL messages entering conversation handler
	console.log('📥 [CONVERSATION HANDLER] Processing message');
	console.log(`   User Query: "${userMessage}"`);
	console.log(`   Has agent state: ${!!currentState}`);
	console.log(
		`   User selected automation mode: ${
			userSelectedAutomationMode || 'none'
		}`
	);

	// Step 0: Handle specific halt reasons before general intent classification
	if (currentState.halt?.reason === 'await_keyword_selection') {
		console.log('📝 [DIRECT INPUT] Handling primary keyword selection');
		const picked = userMessage.trim();
		const userProvidedFields = new Set<string>(
			Array.from((currentState.userProvidedFields || []) as any)
		);
		userProvidedFields.add('primaryKeyword');
		const stateUpdates: Partial<AgentState> = {
			data: {
				...currentState.data,
				primaryKeyword: picked,
			} as BlogData,
			// Clear halt + options so UI doesn't keep showing the primary keyword picker
			halt: null,
			currentStep: 'secondary_keywords' as any,
			keywordCandidates: [],
			keywordResearch: {
				...(currentState.keywordResearch || {} as any),
				primaryCandidates: [],
			} as any,
			userProvidedFields,
		};
		return {
			assistantMessage: `Got it! I've updated the primary keyword to "${picked}".`,
			stateUpdates,
			shouldRunAgent: true,
		};
	}

	if (currentState.halt?.reason === 'await_secondary_selection') {
		console.log(
			'📝 [DIRECT INPUT] Handling secondary keyword selection'
		);
		const secondaryKeywords = userMessage
			.split(',')
			.map((k) => k.trim())
			.filter((k) => k);
		const userProvidedFields = new Set<string>(
			Array.from((currentState.userProvidedFields || []) as any)
		);
		userProvidedFields.add('secondaryKeywords');
		const stateUpdates: Partial<AgentState> = {
			data: {
				...currentState.data,
				secondaryKeywords,
			} as BlogData,
			halt: null, // Clear halt
			currentStep: 'title' as any,
			keywordCandidates: [],
			keywordResearch: {
				...(currentState.keywordResearch || {} as any),
				secondaryCandidates: [],
			} as any,
			userProvidedFields,
		};
		return {
			assistantMessage: `Got it! I've captured: ${secondaryKeywords.length} secondary keywords.`,
			stateUpdates,
			shouldRunAgent: true,
		};
	}

	// Step 1: Classify intent
	const intent: UserIntent = await classifyIntent(
		userMessage,
		currentState,
		apiKey
	);

	// Step 1.5: Fallback check - if message contains automation phrases but was misclassified, override to full_automation
	const automationPhrases = [
		'by yourself',
		'generate blog automatically',
		'you decide',
		'handle it yourself',
		'handle it by yourself',
		'do it yourself',
		'create blog yourself',
		'you choose everything',
		'auto generate',
		'full auto',
		'automatic mode',
		'you handle it',
		'do it automatically',
		'handle automatically',
		'automatically generate',
	];
	const lowerMessage = userMessage.toLowerCase();
	const hasAutomationPhrase = automationPhrases.some((phrase) =>
		lowerMessage.includes(phrase)
	);

	// Override intent if automation phrase detected but not classified as full_automation
	if (
		hasAutomationPhrase &&
		intent.type !== 'full_automation' &&
		intent.type !== 'greeting'
	) {
		// 🤖 LOG: Auto mode triggered via fallback detection
		console.log('🤖 [AUTO MODE TRIGGERED] Via Fallback Detection');
		console.log(`   User Query: "${userMessage}"`);
		console.log(`   Original Intent: ${intent.type}`);
		console.log(`   Trigger: Automation phrase detected in message`);
		console.log(
			`   Matched phrase: ${automationPhrases.find((p) =>
				lowerMessage.includes(p)
			)}`
		);

		intent.type = 'full_automation';
		intent.autoFillRequested = true;
		// Don't extract "blog", "it", etc. as topic
		if (
			intent.extractedData?.topic &&
			['blog', 'it', 'yourself', 'everything'].includes(
				intent.extractedData.topic.toLowerCase()
			)
		) {
			intent.extractedData.topic = null;
		}
	}

	// 🎯 LOG: Intent classification result
	console.log(`🎯 [INTENT CLASSIFIED] Type: ${intent.type}`);
	if (intent.autoFillRequested) {
		console.log(`   Auto-fill requested: true`);
	}

	// Step 2: Handle different intent types
	switch (intent.type) {
		case 'greeting':
			// 👋 LOG: User sent a greeting
			console.log('👋 [GREETING DETECTED]');
			console.log(`   User Query: "${userMessage}"`);
			console.log(
				`   Has started blog creation: ${hasStartedBlogCreation(
					currentState
				)}`
			);
			console.log(`   Action: Sending welcome message`);
			return handleGreeting(currentState);

		case 'help_request':
			// ❓ LOG: User requested help
			console.log('❓ [HELP REQUEST DETECTED]');
			console.log(`   User Query: "${userMessage}"`);
			console.log(
				`   Has started blog creation: ${hasStartedBlogCreation(
					currentState
				)}`
			);
			console.log(`   Action: Showing capabilities and help info`);
			return handleHelpRequest(currentState);

		case 'off_topic':
			// 🚫 LOG: User asked off-topic question
			console.log('🚫 [OFF-TOPIC QUERY DETECTED]');
			console.log(`   User Query: "${userMessage}"`);
			console.log(
				`   Has started blog creation: ${hasStartedBlogCreation(
					currentState
				)}`
			);
			console.log(
				`   Action: Politely redirecting to blog creation`
			);
			return handleOffTopic(currentState);

		case 'full_automation':
			// 🤖 LOG: Auto mode triggered via intent classification
			console.log('🤖 [AUTO MODE TRIGGERED] Via Intent Classifier');
			console.log(`   User Query: "${userMessage}"`);
			console.log(
				`   Trigger: Intent classified as 'full_automation'`
			);
			console.log(
				`   Auto-fill requested: ${intent.autoFillRequested}`
			);
			console.log(
				`   Extracted topic: ${
					intent.extractedData?.topic || 'none'
				}`
			);
			return handleFullAutomation(
				userMessage,
				intent,
				currentState,
				userSelectedAutomationMode
			);

		case 'partial_info':
			// 📝 LOG: User provided partial info
			console.log('📝 [PARTIAL INFO PROVIDED]');
			console.log(`   User Query: "${userMessage}"`);
			console.log(
				`   Has started blog creation: ${hasStartedBlogCreation(
					currentState
				)}`
			);
			console.log(`   Extracted data preview:`, {
				topic: intent.extractedData?.topic || 'none',
				primaryKeyword:
					intent.extractedData?.primaryKeyword || 'none',
				title: intent.extractedData?.title || 'none',
			});
			return handlePartialInfo(
				userMessage,
				intent,
				currentState,
				apiKey,
				userSelectedAutomationMode
			);

		case 'query':
			// 💬 LOG: User asked a question
			console.log('💬 [QUERY DETECTED]');
			console.log(`   User Query: "${userMessage}"`);
			console.log(
				`   Specific request: ${
					intent.specificRequest || 'general question'
				}`
			);
			console.log(
				`   Action: Answering query and checking for action required`
			);
			return handleQueryIntent(userMessage, currentState, apiKey);

		case 'approval':
			// ✅ LOG: User approved
			console.log('✅ [APPROVAL DETECTED]');
			console.log(`   User Query: "${userMessage}"`);
			console.log(
				`   Current halt reason: ${
					currentState.halt?.reason || 'none'
				}`
			);
			console.log(`   Action: Proceeding with approved item`);
			return handleApproval(currentState);

		case 'skip_step':
			// ⏭️ LOG: User wants to skip
			console.log('⏭️ [SKIP REQUEST DETECTED]');
			console.log(`   User Query: "${userMessage}"`);
			console.log(
				`   Current halt reason: ${
					currentState.halt?.reason || 'none'
				}`
			);
			console.log(`   Action: Skipping current step`);
			return handleSkipStep(currentState);

		case 'manual_control':
			// 🎮 LOG: User wants manual control
			console.log('🎮 [MANUAL CONTROL REQUEST DETECTED]');
			console.log(`   User Query: "${userMessage}"`);
			console.log(
				`   Control preferences:`,
				intent.controlPreferences
			);
			console.log(`   Action: Setting manual control preferences`);
			return handleManualControl(
				intent,
				currentState,
				userSelectedAutomationMode
			);

		case 'refinement':
			// 🔄 LOG: User wants to refine/modify
			console.log('🔄 [REFINEMENT REQUEST DETECTED]');
			console.log(`   User Query: "${userMessage}"`);
			console.log(
				`   Current halt reason: ${
					currentState.halt?.reason || 'none'
				}`
			);
			console.log(
				`   Outline approved: ${currentState.outlineApproved}`
			);
			console.log(`   Action: Handling refinement/modification`);
			return handleRefinement(userMessage, currentState);

		default:
			return {
				assistantMessage:
					"I understand. Let's proceed with your blog.",
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
		state.data.secondaryKeywords?.length > 0 ||
		state.data.referenceUrls?.length > 0 ||
		state.data.interlinks?.length > 0
	);
};

// Helper to generate reminder message about missing info
const getMissingInfoMessage = (state: AgentState): string => {
	const missing: string[] = [];

	if (!state.data.topic) missing.push('**Topic**');
	if (
		!state.data.primaryKeyword &&
		!state.userProvidedFields?.has('primaryKeyword')
	) {
		missing.push('**Primary Keyword** (or I can research it for you)');
	}

	if (missing.length === 0) {
		return "Let's continue with your blog creation!";
	}

	return `To continue, I still need:\n${missing
		.map((m) => `- ${m}`)
		.join(
			'\n'
		)}\n\nPlease provide these details, or say **\"generate blog automatically\"** to let me handle everything!`;
};

// Handler for greetings
const handleGreeting = (currentState: AgentState): ConversationResponse => {
	// If user has already started, acknowledge and resume
	if (hasStartedBlogCreation(currentState)) {
		return {
			assistantMessage: `Hello! 👋 Nice to hear from you again!\n\n${getMissingInfoMessage(
				currentState
			)}`,
			stateUpdates: {},
			shouldRunAgent: false,
		};
	}

	// First time greeting - full welcome
	return {
		assistantMessage:
			"Hello! 👋 Great to see you! I'm your Blog Agent, here to help you create SEO-optimized blog posts.\n\nTo get started, just tell me what topic you'd like to write about, or say **\"generate blog automatically\"** and I'll handle everything!\n\nHow can I help you today?",
		stateUpdates: {},
		shouldRunAgent: false,
	};
};

// Handler for help requests
const handleHelpRequest = (currentState: AgentState): ConversationResponse => {
	// If user has already started, give brief help and resume
	if (hasStartedBlogCreation(currentState)) {
		return {
			assistantMessage:
				"I can help you create an SEO-optimized blog post! I'll handle keyword research, title generation, content outlining, and writing.\n\n" +
				getMissingInfoMessage(currentState),
			stateUpdates: {},
			shouldRunAgent: false,
		};
	}

	// First time - full capabilities
	return {
		assistantMessage:
			"I'm your AI Blog Agent! 🤖 Here's what I can help you with:\n\n✍️ **Create SEO-Optimized Blogs** - I'll write comprehensive, engaging content\n🔍 **Keyword Research** - Find the best keywords for your topic\n📝 **Title Generation** - Create compelling, SEO-friendly titles\n📋 **Content Outlines** - Structure your blog professionally\n🔗 **Internal/External Links** - Add relevant references\n\n**To get started:**\n- Tell me your blog topic\n- Provide keywords if you have them\n- Or say **\"generate blog automatically\"** and let me handle everything!\n\nWhat would you like to create today?",
		stateUpdates: {},
		shouldRunAgent: false,
	};
};

// Handler for off-topic queries
const handleOffTopic = (currentState: AgentState): ConversationResponse => {
	// If user has already started, politely redirect and resume
	if (hasStartedBlogCreation(currentState)) {
		return {
			assistantMessage:
				"I appreciate the question, but let's focus on your blog for now! 📝\n\n" +
				getMissingInfoMessage(currentState),
			stateUpdates: {},
			shouldRunAgent: false,
		};
	}

	// First time - full redirect message
	return {
		assistantMessage:
			"I appreciate your question, but I'm specifically designed to help you create amazing blog content! 📝\n\nI focus on:\n- Blog writing and content creation\n- SEO optimization\n- Keyword research\n- Title generation\n- Content outlines\n\nIf you'd like to create a blog post, I'm here to help! Just tell me your topic or say **\"generate blog automatically\"**.\n\nWhat blog would you like to create?",
		stateUpdates: {},
		shouldRunAgent: false,
	};
};

const handleFullAutomation = (
	userMessage: string,
	intent: UserIntent,
	currentState: AgentState,
	userSelectedAutomationMode?: 'full' | 'guided' | 'manual'
): ConversationResponse => {
	const topic =
		intent.extractedData?.topic || currentState.data.topic || null;

	// If no topic is available, ask for it
	if (!topic || topic.trim() === '') {
		return {
			assistantMessage:
				"Great! I'll handle everything automatically. What topic would you like me to write about?",
			stateUpdates: {
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
			shouldRunAgent: false,
		};
	}

	// ✅ ALWAYS use full automation - this function is only called when user requests automation
	// Ignore UI control level setting when user explicitly says automation phrases
	const automationLevel = 'full';
	const isFullAuto = true;

	const stateUpdates: Partial<AgentState> = {
		data: {
			...currentState.data,
			topic,
		} as BlogData,
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
		userProvidedFields: topic ? new Set(['topic']) : new Set([]),
	};

	const message = isFullAuto
		? `Perfect! I'll create a comprehensive blog about "${topic}". I'll research keywords, generate a title, create an outline, and write the full content. This will take a few minutes. You can watch the progress in real-time.`
		: `Got it! I'll help you create a blog about "${topic}". Let me start by researching keywords.`;

	// 🤖 LOG: Auto mode state configuration
	console.log('🤖 [AUTO MODE STATE SET]');
	console.log(`   Topic: "${topic}"`);
	console.log(`   Automation Level: ${automationLevel}`);
	console.log(`   Skip Optional Steps: ${isFullAuto}`);
	console.log(
		`   Auto-fill Fields: [${Array.from(
			stateUpdates.autoFillFields || []
		).join(', ')}]`
	);
	console.log(`   Show Progress: ${isFullAuto}`);

	return {
		assistantMessage: message,
		stateUpdates,
		shouldRunAgent: true,
		showProgress: isFullAuto,
	};
};

const handlePartialInfo = async (
	userMessage: string,
	intent: UserIntent,
	currentState: AgentState,
	apiKey: string,
	userSelectedAutomationMode?: 'full' | 'guided' | 'manual'
): Promise<ConversationResponse> => {
	const isGibberishLike = (text: string): boolean => {
		const t = (text || '').trim();
		if (t.length < 3) return false;
		if (!/[a-zA-Z]/.test(t)) return true;
		const vowels = (t.match(/[aeiouAEIOU]/g) || []).length;
		const consonants = (t.match(/[bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ]/g) || []).length;
		const total = vowels + consonants;
		if (total > 0 && t.length > 8 && vowels / total < 0.15) return true;
		if (/(.)\1{4,}/.test(t)) return true;
		const tooManySpecialChars = (t.match(/[^a-zA-Z0-9\s]/g) || []).length > t.length * 0.35;
		if (tooManySpecialChars) return true;
		return false;
	};

	const isValidTopicInput = (topic: string | null | undefined): boolean => {
		if (!topic) return false;
		const t = topic.trim();
		if (t.length < 3) return false;
		if (isGibberishLike(t)) return false;
		const invalid = new Set([
			'blog',
			'it',
			'yourself',
			'everything',
			'something',
			'anything',
			'yes',
			'no',
			'ok',
			'okay',
			'sure',
			'maybe',
			'thanks',
			'thank you',
		]);
		if (invalid.has(t.toLowerCase())) return false;
		return true;
	};

	const isValidKeywordInput = (kw: string | null | undefined): boolean => {
		if (!kw) return false;
		const t = kw.trim();
		if (t.length < 2) return false;
		if (isGibberishLike(t)) return false;
		return true;
	};
	// Check if message contains automation phrases (safety fallback)
	const automationPhrases = [
		'by yourself',
		'generate blog automatically',
		'you decide',
		'handle it yourself',
		'handle it by yourself',
		'do it yourself',
		'create blog yourself',
		'you choose everything',
		'auto generate',
		'full auto',
		'automatic mode',
		'you handle it',
		'do it automatically',
		'handle automatically',
		'automatically generate',
	];
	const lowerMessage = userMessage.toLowerCase();
	const hasAutomationPhrase = automationPhrases.some((phrase) =>
		lowerMessage.includes(phrase)
	);

	// If automation phrase detected, treat as full automation request
	const shouldAutoFill = intent.autoFillRequested || hasAutomationPhrase;

	// 🤖 LOG: Auto mode check in partial info handler
	if (shouldAutoFill) {
		console.log('🤖 [AUTO MODE TRIGGERED] Via Partial Info Handler');
		console.log(`   User Query: "${userMessage}"`);
		console.log(
			`   Trigger: Auto-fill requested or automation phrase detected`
		);
		console.log(`   Intent auto-fill: ${intent.autoFillRequested}`);
		console.log(`   Has automation phrase: ${hasAutomationPhrase}`);
	}

	// Extract data from message
	const extractedData = await extractDataFromMessage(userMessage, apiKey);

	const attemptedTopic = extractedData.topic && extractedData.topic.trim() ? extractedData.topic.trim() : '';
	const attemptedKeyword = extractedData.primaryKeyword && extractedData.primaryKeyword.trim()
		? extractedData.primaryKeyword.trim()
		: '';

	// If the user is requesting automation, do not let the extractor accidentally
	// overwrite the topic unless the message explicitly contains a topic pattern.
	if (shouldAutoFill || hasAutomationPhrase) {
		const explicitTopic = extractTopicFromMessage(userMessage);
		if (!explicitTopic) {
			extractedData.topic = null;
		}
	}

	// Drop invalid/gibberish topic/keyword inputs before they get merged into state
	if (extractedData.topic && !isValidTopicInput(extractedData.topic)) {
		extractedData.topic = null;
	}
	if (extractedData.primaryKeyword && !isValidKeywordInput(extractedData.primaryKeyword)) {
		extractedData.primaryKeyword = null;
	}

	// If the user attempted to provide a topic/keyword but it was invalid, stop and ask again.
	if (attemptedTopic && !isValidTopicInput(attemptedTopic)) {
		return {
			assistantMessage:
				`I couldn't understand **"${attemptedTopic}"** as a topic. Please share a clear topic (e.g., "portable espresso makers", "Pulumi vs Terraform", "email deliverability best practices").`,
			stateUpdates: {},
			shouldRunAgent: false,
		};
	}
	if (attemptedKeyword && !isValidKeywordInput(attemptedKeyword)) {
		return {
			assistantMessage:
				`I couldn't use **"${attemptedKeyword}"** as a keyword. Please provide a clear SEO keyword/phrase (e.g., "portable espresso maker", "best espresso maker for travel").`,
			stateUpdates: {},
			shouldRunAgent: false,
		};
	}

	// Merge extracted data with current data
	const updatedData: Partial<BlogData> = {
		...currentState.data,
	};

	const providedFields = new Set(currentState.userProvidedFields || []);

	if (extractedData.topic && extractedData.topic.trim()) {
		updatedData.topic = extractedData.topic;
		providedFields.add('topic');
	}
	if (extractedData.primaryKeyword) {
		updatedData.primaryKeyword = extractedData.primaryKeyword;
		providedFields.add('primaryKeyword');
	}
	if (
		extractedData.secondaryKeywords &&
		extractedData.secondaryKeywords.length > 0
	) {
		updatedData.secondaryKeywords = extractedData.secondaryKeywords;
		providedFields.add('secondaryKeywords');
	}
	if (extractedData.title) {
		updatedData.title = extractedData.title;
		providedFields.add('title');
	}
	if (extractedData.targetLocation) {
		updatedData.targetLocation = extractedData.targetLocation;
		providedFields.add('targetLocation');
	}
	if (
		extractedData.referenceUrls &&
		extractedData.referenceUrls.length > 0
	) {
		updatedData.referenceUrls = [
			...(currentState.data.referenceUrls || []),
			...extractedData.referenceUrls,
		];
		providedFields.add('referenceUrls');
	}
	if (extractedData.interlinks && extractedData.interlinks.length > 0) {
		const newInterlinks = extractedData.interlinks.map((link, idx) => ({
			id: `${Date.now()}-${idx}`,
			keyword: link.keyword,
			url: link.url,
		}));
		updatedData.interlinks = [
			...(currentState.data.interlinks || []),
			...newInterlinks,
		];
		providedFields.add('interlinks');
	}

	// Build response message
	const capturedItems = [];
	if (extractedData.topic)
		capturedItems.push(`topic: "${extractedData.topic}"`);
	if (extractedData.primaryKeyword)
		capturedItems.push(`keyword: "${extractedData.primaryKeyword}"`);
	if (extractedData.title)
		capturedItems.push(`title: "${extractedData.title}"`);
	if (extractedData.targetLocation)
		capturedItems.push(`location: ${extractedData.targetLocation}`);

	// Check if we have any useful data
	const hasTopic = !!(updatedData.topic || currentState.data.topic);
	const hasLocation = !!(
		updatedData.targetLocation ||
		currentState.data.targetLocation ||
		providedFields.has('targetLocation')
	);
	const hasKeyword = !!updatedData.primaryKeyword;
	const hasTitle = !!updatedData.title;

	// ✅ Prioritize automation phrases over UI selection
	// If shouldAutoFill is true (automation phrases detected), ALWAYS use 'full'
	const automationLevel = shouldAutoFill
		? 'full'
		: userSelectedAutomationMode || 'guided';
	const isFullAuto = automationLevel === 'full';

	// If no meaningful data was extracted and automation is requested, ask for topic
	if (!hasTopic && !hasKeyword && !hasTitle && capturedItems.length === 0) {
		if (shouldAutoFill || hasAutomationPhrase) {
			return {
				assistantMessage:
					"Great! I'll handle everything automatically. What topic would you like me to write about?",
				stateUpdates: {
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
				shouldRunAgent: false,
			};
		} else {
			return {
				assistantMessage:
					"I'd love to help! Could you please provide more details? What topic would you like to write about?",
				stateUpdates: {},
				shouldRunAgent: false,
			};
		}
	}

	let message =
		capturedItems.length > 0
			? `✅ **Information captured!**\n\nI've saved: ${capturedItems.join(
					', '
			  )}.`
			: `✅ **Ready to proceed!**`;

	// If topic provided but location not provided and not already set, ask for location
	if (hasTopic && !hasLocation && !isFullAuto) {
		message += `\n\nWhich country/region should I target for SEO? (e.g., United States, United Kingdom, Canada, Global, etc.)`;

		const stateUpdates: Partial<AgentState> = {
			data: updatedData as BlogData,
			userProvidedFields: providedFields,
			preferences: {
				automationLevel,
				skipOptionalSteps: false,
				autoSelectBestOptions: false,
			},
		};

		return {
			assistantMessage: message,
			stateUpdates,
			shouldRunAgent: false, // Don't run agent yet, wait for location
		};
	}

	const autoFillFields = new Set<string>();

	if (isFullAuto) {
		if (!hasKeyword) autoFillFields.add('primaryKeyword');
		if (!hasTitle) autoFillFields.add('title');
		autoFillFields.add('secondaryKeywords');
		message += ` I'll automatically select the best options for the rest.`;
	} else {
		if (!hasKeyword) {
			message += ` Let me research keywords for you.`;
		} else if (!hasTitle) {
			message += ` Let me generate title options.`;
		} else {
			message += ` Ready to create the outline!`;
		}
	}

	// Check if critical fields were updated that require flow restart
	const criticalFieldsUpdated =
		(extractedData.topic &&
			currentState.data.topic &&
			extractedData.topic !== currentState.data.topic) ||
		(extractedData.primaryKeyword &&
			currentState.data.primaryKeyword &&
			extractedData.primaryKeyword !==
				currentState.data.primaryKeyword);

	const stateUpdates: Partial<AgentState> = {
		data: updatedData as BlogData,
		userProvidedFields: providedFields,
		autoFillFields,
		preferences: {
			automationLevel,
			skipOptionalSteps: isFullAuto,
			autoSelectBestOptions: isFullAuto,
		},
	};

	// ✨ RESET LOGIC: If critical fields changed, reset downstream progress
	if (criticalFieldsUpdated) {
		console.log(
			'🔄 [FLOW RESTART] Critical fields updated, resetting progress flags'
		);
		stateUpdates.titleSelected = false;
		stateUpdates.titleOptions = [];
		stateUpdates.outline = [];
		stateUpdates.outlineApproved = false;
		stateUpdates.draft = '';
		stateUpdates.finalBlogGenerated = false;
		stateUpdates.progress = { sectionIndex: 0 };
		stateUpdates.halt = null; // Clear halt to trigger re-routing
	}

	return {
		assistantMessage: message,
		stateUpdates,
		shouldRunAgent: true,
	};
};

const handleQueryIntent = async (
	userMessage: string,
	currentState: AgentState,
	apiKey: string
): Promise<ConversationResponse> => {
	const queryResponse = await handleQuery(
		userMessage,
		currentState,
		apiKey
	);

	const stateUpdates: Partial<AgentState> = {};
	let shouldRunAgent = false;

	// Handle action if needed
	if (queryResponse.actionRequired === 'run_keyword_research') {
		stateUpdates.autoFillFields = new Set(['primaryKeyword']);
		shouldRunAgent = true;
	} else if (queryResponse.actionRequired === 'run_title_generation') {
		stateUpdates.autoFillFields = new Set(['title']);
		shouldRunAgent = true;
	} else if (queryResponse.actionRequired === 'skip_step') {
		return handleSkipStep(currentState);
	}

	return {
		assistantMessage: queryResponse.answer,
		stateUpdates,
		shouldRunAgent,
	};
};

const handleApproval = (currentState: AgentState): ConversationResponse => {
	const stateUpdates: Partial<AgentState> = {};

	// Handle different approval contexts
	if (currentState.halt?.reason === 'awaiting_approval') {
		stateUpdates.outlineApproved = true;
		stateUpdates.needsApproval = false;
		stateUpdates.halt = null;
		// Keep step on outline so the router can advance to proposal/generation.
		stateUpdates.currentStep = 'outline' as any;
		return {
			assistantMessage:
				'Great! Starting blog generation section by section...',
			stateUpdates,
			shouldRunAgent: true,
		};
	}

	if (currentState.halt?.reason === 'await_keyword_selection') {
		// Auto-select top keyword
		const candidates =
			currentState.keywordResearch?.primaryCandidates || [];
		if (candidates.length > 0) {
			stateUpdates.data = {
				...currentState.data,
				primaryKeyword: candidates[0].text,
			} as BlogData;
			return {
				assistantMessage: `I'll use "${candidates[0].text}" as the primary keyword.`,
				stateUpdates,
				shouldRunAgent: true,
			};
		}
	}

	return {
		assistantMessage: 'Approved! Continuing...',
		stateUpdates,
		shouldRunAgent: true,
	};
};

const handleSkipStep = (currentState: AgentState): ConversationResponse => {
	const stateUpdates: Partial<AgentState> = {};

	// Mark current step as complete based on halt reason
	if (currentState.halt?.reason === 'await_interlinking') {
		stateUpdates.interlinkingCompleted = true;
	} else if (currentState.halt?.reason === 'await_references') {
		stateUpdates.referencesCollected = true;
	} else if (currentState.halt?.reason === 'await_secondary_selection') {
		// Skip secondary keywords
		stateUpdates.data = {
			...currentState.data,
			secondaryKeywords: [],
		} as BlogData;
	}

	return {
		assistantMessage: 'Skipping this step. Moving forward...',
		stateUpdates,
		shouldRunAgent: true,
	};
};

const handleManualControl = (
	intent: UserIntent,
	currentState: AgentState,
	userSelectedAutomationMode?: 'full' | 'guided' | 'manual'
): ConversationResponse => {
	const prefs = intent.controlPreferences || {};
	const message = [];

	if (prefs.wantsToChooseKeywords) {
		message.push("You'll select the keywords");
	}
	if (prefs.wantsToChooseTitle) {
		message.push("You'll choose the title");
	}
	if (prefs.skipOptionalSteps) {
		message.push("We'll skip optional steps");
	}

	// Use user's UI selection or default to manual
	const automationLevel = userSelectedAutomationMode || 'manual';

	const stateUpdates: Partial<AgentState> = {
		preferences: {
			automationLevel,
			skipOptionalSteps: prefs.skipOptionalSteps || false,
			autoSelectBestOptions: false,
		},
	};

	return {
		assistantMessage: `Understood! ${message.join(', ')}. Let's start!`,
		stateUpdates,
		shouldRunAgent: true,
	};
};

const handleRefinement = (
	userMessage: string,
	currentState: AgentState
): ConversationResponse => {
	// ✨ Check if user is refining topic or keywords
	const extractedTopic = extractTopicFromMessage(userMessage);
	const isTopicRefinement =
		extractedTopic &&
		extractedTopic.toLowerCase() !== 'blog topic' &&
		extractedTopic.length > 3;

	if (isTopicRefinement) {
		console.log(
			`🔄 [REFINEMENT] Topic change detected: "${extractedTopic}". Resetting flow.`
		);
		return {
			assistantMessage: `Got it! I'll update the topic to "${extractedTopic}" and restart the process.`,
			stateUpdates: {
				data: {
					...currentState.data,
					topic: extractedTopic,
				} as BlogData,
				// Reset all progress flags
				titleSelected: false,
				titleOptions: [],
				outline: [],
				outlineApproved: false,
				draft: '',
				finalBlogGenerated: false,
				progress: { sectionIndex: 0 },
				halt: null,
			},
			shouldRunAgent: true,
		};
	}

	// ✨ Outline approval stage: only treat message as outline feedback when it actually
	// looks like outline feedback. Otherwise, ask clarification to avoid regenerating
	// outline on off-topic messages.
	if (
		currentState.halt?.reason === 'awaiting_approval' &&
		currentState.outline &&
		currentState.outline.length > 0 &&
		!currentState.outlineApproved
	) {
		const t = userMessage.trim().toLowerCase();
		const outlineFeedbackSignals = [
			'outline',
			'section',
			'heading',
			'h2',
			'add',
			'remove',
			'delete',
			'reorder',
			'move',
			'rename',
			'include',
			'exclude',
			'more',
			'less',
			'too long',
			'too short',
			'focus',
			'emphasize',
			'skip',
		];
		const looksLikeOutlineFeedback = outlineFeedbackSignals.some((k) => t.includes(k));

		if (!looksLikeOutlineFeedback) {
			return {
				assistantMessage:
					`Are you giving feedback on the outline, or do you want to change the topic?\n\n- If it's **outline feedback**, tell me what to change (e.g., "add a section on pricing", "remove the intro", "reorder sections").\n- If it's a **topic change**, say: "write about ..."`,
				stateUpdates: {},
				shouldRunAgent: false,
			};
		}

		console.log(
			'📝 [OUTLINE FEEDBACK] User provided feedback, preparing to regenerate outline...'
		);
		return {
			assistantMessage:
				"Got it! I'll regenerate the outline based on your feedback. Please wait...",
			stateUpdates: {
				outlineFeedback: userMessage,
				outlineApproved: false, // Keep it unapproved
			},
			shouldRunAgent: true, // Run the agent to regenerate
		};
	}

	// Default refinement handler
	return {
		assistantMessage:
			"I'll help you refine the content. What specifically would you like to improve?",
		stateUpdates: {},
		shouldRunAgent: false,
	};
};

const extractTopicFromMessage = (message: string): string => {
	// Simple extraction - look for common patterns
	const patterns = [
		/write (?:a blog )?about (.+?)(?:\.|,|$)/i,
		/blog (?:post )?on (.+?)(?:\.|,|$)/i,
		/topic[:\s]+(.+?)(?:\.|,|$)/i,
	];

	for (const pattern of patterns) {
		const match = message.match(pattern);
		if (match) return match[1].trim();
	}

	// No explicit topic found
	return '';
};
