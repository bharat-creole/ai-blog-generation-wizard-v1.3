import { BlogData, AutomationLevel } from '../../../types';
import { AgentState } from '../../../server/agent/state';

/**
 * Setters interface for agent state updates
 */
export interface AgentStateSetters {
	setAgent: (agent: AgentState | null) => void;
	setOutline: (outline: any[]) => void;
	setDraft: (draft: string) => void;
	setUserTopic: (topic: string) => void;
	setTargetLocation: (location: string) => void;
	setTraceItems: (items: Array<{ step: string; at: number }>) => void;
	setOutlineApproved?: (approved: boolean) => void;
	setShowBlogContent?: (show: boolean) => void;
	setViewMode?: (mode: 'outline' | 'blog' | 'markdown') => void;
}

/**
 * Initializes agent state from blog data
 * @param data - Blog data
 * @param userTopic - User-provided topic
 * @param targetLocation - Target location
 * @param draft - Current draft content
 * @param messages - Current messages
 * @param apiKey - API key
 * @param automationLevel - Automation level
 * @returns Initialized AgentState
 */
export const initializeAgentState = (
	data: BlogData,
	userTopic: string,
	targetLocation: string,
	draft: string,
	messages: any[],
	apiKey: string,
	automationLevel: AutomationLevel
): AgentState => {
	return {
		data: {
			...data,
			topic: userTopic || data.topic || '',
			targetLocation:
				targetLocation ||
				data.targetLocation ||
				'United States',
			primaryKeyword: data.primaryKeyword || '',
			secondaryKeywords: data.secondaryKeywords || [],
			title: data.title || '',
			interlinks: data.interlinks || [],
			referenceUrls: data.referenceUrls || [],
			referenceFiles: data.referenceFiles || [],
		},
		apiKey,
		outline: [...(data.outline || [])],
		outlineApproved: false,
		draft,
		messages: messages,
		progress: { sectionIndex: 0 },
		policy: {
			referencesUsage: 'both',
			grounding: true,
		},
		trace: [],
		halt: null,
		titleSelected: false,
		interlinkingCompleted: false,
		referencesCollected: false,
		finalBlogGenerated: false,
		preferences: {
			automationLevel,
			skipOptionalSteps: automationLevel === 'full',
			autoSelectBestOptions: automationLevel === 'full',
		},
		userProvidedFields: new Set(),
		autoFillFields: new Set(),
	} as AgentState;
};

/**
 * Updates agent state from working state
 * @param working - Current working agent state
 * @param setters - State setters
 */
export const updateAgentFromWorking = (
	working: AgentState,
	setters: AgentStateSetters
): void => {
	setters.setAgent(working);
	setters.setOutline(working.outline);
	setters.setDraft(working.draft);
	setters.setUserTopic(working.data.topic || '');
	setters.setTargetLocation(working.data.targetLocation || 'United States');
	setters.setTraceItems(
		working.trace.map((t) => ({ step: t.step, at: t.at }))
	);

	// Optional setters
	if (working.outlineApproved && setters.setOutlineApproved) {
		setters.setOutlineApproved(true);
	}
	if (working.outlineApproved && setters.setShowBlogContent) {
		setters.setShowBlogContent(true);
	}
	if (working.outlineApproved && setters.setViewMode) {
		setters.setViewMode('markdown');
	}
};

/**
 * Syncs agent state to blog data
 * @param working - Current working agent state
 * @param updateData - Function to update blog data
 */
export const syncAgentStateToData = (
	working: AgentState,
	updateData: (data: Partial<BlogData>) => void
): void => {
	updateData({
		outline: working.outline,
		blogContent: working.draft,
		primaryKeyword: working.data.primaryKeyword,
		secondaryKeywords: working.data.secondaryKeywords,
		topic: working.data.topic,
		targetLocation: working.data.targetLocation,
	});
};

/**
 * Creates a modified agent state for regeneration
 * @param agent - Current agent state
 * @returns Modified agent state with cleared outline and draft
 */
export const createModifiedAgentForRegeneration = (
	agent: AgentState
): AgentState => {
	return {
		...agent,
		outlineApproved: false,
		outline: [],
		draft: '',
		finalBlogGenerated: false,
	};
};

/**
 * Updates all state from working agent state (optimized version)
 * @param working - Current working agent state
 * @param setters - State setters object
 * @param updateData - Optional function to update blog data
 */
export const updateAllStateFromWorking = (
	working: AgentState,
	setters: AgentStateSetters,
	updateData?: (data: Partial<BlogData>) => void
): void => {
	// Update React state
	updateAgentFromWorking(working, setters);

	// Update blog data if provided
	if (updateData) {
		syncAgentStateToData(working, updateData);
	}
};
