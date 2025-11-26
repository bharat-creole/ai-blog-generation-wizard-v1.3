import { BlogData, AutomationLevel, ChatMessage, OutlineSection } from '../../../types';
import { AgentState } from '../../../services/langgraph/agentGraph';

/**
 * Flow context state interface
 */
export interface FlowContext {
	automationLevel: AutomationLevel;
	hasProvidedInfo: boolean;
	missingFields: string[];
	awaitingConfirmation: boolean;
	currentStep: string;
	modificationInProgress: boolean;
	userRequestedAutomation: boolean;
	pendingModificationRequest: string | null;
}

/**
 * Agent state setters interface
 */
export interface AgentStateSetters {
	setAgent: (agent: AgentState | null) => void;
	setOutline: (outline: OutlineSection[]) => void;
	setDraft: (draft: string) => void;
	setUserTopic: (topic: string) => void;
	setTargetLocation: (location: string) => void;
	setTraceItems: (items: Array<{ step: string; at: number }>) => void;
	setOutlineApproved?: (approved: boolean) => void;
	setShowBlogContent?: (show: boolean) => void;
	setViewMode?: (mode: 'outline' | 'blog' | 'markdown') => void;
}

/**
 * Agent execution options
 */
export interface AgentExecutionOptions {
	maxIterations?: number;
	onProgress?: (working: AgentState) => void;
	onStateUpdate?: (working: AgentState) => void;
	onHalt?: (working: AgentState) => boolean;
}

/**
 * Blog generation flow result
 */
export interface BlogGenerationResult {
	success: boolean;
	message?: string;
	agent?: AgentState;
}

/**
 * Modification flow result
 */
export interface ModificationFlowResult {
	success: boolean;
	message: string;
	agent?: AgentState;
	updatedData?: Partial<BlogData>;
}

