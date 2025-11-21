import { AgentState } from './langgraph/agentGraph';
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
	// Step 1: Classify intent
	const intent: UserIntent = await classifyIntent(
		userMessage,
		currentState,
		apiKey
	);

	// Step 2: Handle different intent types
	switch (intent.type) {
		case 'full_automation':
			return handleFullAutomation(userMessage, intent, currentState, userSelectedAutomationMode);

		case 'partial_info':
			return handlePartialInfo(userMessage, intent, currentState, apiKey, userSelectedAutomationMode);

		case 'query':
			return handleQueryIntent(userMessage, currentState, apiKey);

		case 'approval':
			return handleApproval(currentState);

		case 'skip_step':
			return handleSkipStep(currentState);

		case 'manual_control':
			return handleManualControl(intent, currentState, userSelectedAutomationMode);

		case 'refinement':
			return handleRefinement(userMessage, currentState);

		default:
			return {
				assistantMessage: "I understand. Let's proceed with your blog.",
				stateUpdates: {},
				shouldRunAgent: true,
			};
	}
};

const handleFullAutomation = (
	userMessage: string,
	intent: UserIntent,
	currentState: AgentState,
	userSelectedAutomationMode?: 'full' | 'guided' | 'manual'
): ConversationResponse => {
	const topic =
		intent.extractedData?.topic ||
		currentState.data.topic ||
		extractTopicFromMessage(userMessage);

	// Use user's UI selection if they didn't explicitly request full automation in the message
	const automationLevel = userSelectedAutomationMode || 'full';
	const isFullAuto = automationLevel === 'full';

	const stateUpdates: Partial<AgentState> = {
		data: {
			...currentState.data,
			topic,
		} as BlogData,
		preferences: {
			automationLevel: automationLevel,
			skipOptionalSteps: isFullAuto,
			autoSelectBestOptions: isFullAuto,
		},
		autoFillFields: isFullAuto
			? new Set(['primaryKeyword', 'secondaryKeywords', 'title'])
			: new Set([]),
		userProvidedFields: topic ? new Set(['topic']) : new Set([]),
	};

	const message = isFullAuto
		? `Perfect! I'll create a comprehensive blog about "${topic}". I'll research keywords, generate a title, create an outline, and write the full content. This will take a few minutes. You can watch the progress in real-time.`
		: `Got it! I'll help you create a blog about "${topic}". Let me start by researching keywords.`;

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
	// Extract data from message
	const extractedData = await extractDataFromMessage(userMessage, apiKey);

	// Merge extracted data with current data
	const updatedData: Partial<BlogData> = {
		...currentState.data,
	};

	const providedFields = new Set(currentState.userProvidedFields || []);

	if (extractedData.topic) {
		updatedData.topic = extractedData.topic;
		providedFields.add('topic');
	}
	if (extractedData.primaryKeyword) {
		updatedData.primaryKeyword = extractedData.primaryKeyword;
		providedFields.add('primaryKeyword');
	}
	if (extractedData.secondaryKeywords && extractedData.secondaryKeywords.length > 0) {
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
	if (extractedData.referenceUrls && extractedData.referenceUrls.length > 0) {
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
	if (extractedData.topic) capturedItems.push(`topic: "${extractedData.topic}"`);
	if (extractedData.primaryKeyword)
		capturedItems.push(`keyword: "${extractedData.primaryKeyword}"`);
	if (extractedData.title) capturedItems.push(`title: "${extractedData.title}"`);
	if (extractedData.targetLocation)
		capturedItems.push(`location: ${extractedData.targetLocation}`);

	let message = `Got it! I've captured: ${capturedItems.join(', ')}.`;

	// Check if location is missing
	const hasTopic = !!(updatedData.topic);
	const hasLocation = !!(extractedData.targetLocation || providedFields.has('targetLocation'));
	const hasKeyword = !!(updatedData.primaryKeyword);
	const hasTitle = !!(updatedData.title);

	// Use user's UI selection or detect from message
	const automationLevel = userSelectedAutomationMode || (intent.autoFillRequested ? 'full' : 'guided');
	const isFullAuto = automationLevel === 'full';
	
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

const handleApproval = (
	currentState: AgentState
): ConversationResponse => {
	const stateUpdates: Partial<AgentState> = {};

	// Handle different approval contexts
	if (currentState.halt?.reason === 'awaiting_approval') {
		stateUpdates.outlineApproved = true;
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

const handleSkipStep = (
	currentState: AgentState
): ConversationResponse => {
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
	// ✨ Check if we're in outline approval stage and user is providing feedback
	if (currentState.halt?.reason === 'awaiting_approval' && 
	    currentState.outline && 
	    currentState.outline.length > 0 && 
	    !currentState.outlineApproved) {
		
		console.log('📝 [OUTLINE FEEDBACK] User provided feedback, preparing to regenerate outline...');
		
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

	// Fallback: use first few words
	const words = message.split(' ').slice(0, 5).join(' ');
	return words || 'Blog Topic';
};

