import { useState, useRef, useMemo } from 'react';
import {
	BlogData,
	ChatMessage,
	OutlineSection,
	AutomationLevel,
} from '../../../types';
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
 * Agent state hook return type
 */
export interface UseAgentStateReturn {
	// Flow context
	flowContext: FlowContext;
	setFlowContext: React.Dispatch<React.SetStateAction<FlowContext>>;

	// Messages
	messages: ChatMessage[];
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;

	// Input
	input: string;
	setInput: React.Dispatch<React.SetStateAction<string>>;

	// Blog content
	draft: string;
	setDraft: React.Dispatch<React.SetStateAction<string>>;
	userTopic: string;
	setUserTopic: React.Dispatch<React.SetStateAction<string>>;
	targetLocation: string;
	setTargetLocation: React.Dispatch<React.SetStateAction<string>>;
	outline: OutlineSection[];
	setOutline: React.Dispatch<React.SetStateAction<OutlineSection[]>>;
	outlineApproved: boolean;
	setOutlineApproved: React.Dispatch<React.SetStateAction<boolean>>;
	showBlogContent: boolean;
	setShowBlogContent: React.Dispatch<React.SetStateAction<boolean>>;

	// UI state
	isThinking: boolean;
	setIsThinking: React.Dispatch<React.SetStateAction<boolean>>;
	isStreaming: boolean;
	setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>;
	error: string | null;
	setError: React.Dispatch<React.SetStateAction<string | null>>;
	traceItems: Array<{ step: string; at: number }>;
	setTraceItems: React.Dispatch<
		React.SetStateAction<Array<{ step: string; at: number }>>
	>;

	// SEO state
	seoScore: number | null;
	setSeoScore: React.Dispatch<React.SetStateAction<number | null>>;
	seoPrimary: string;
	setSeoPrimary: React.Dispatch<React.SetStateAction<string>>;
	seoCritical: string;
	setSeoCritical: React.Dispatch<React.SetStateAction<string>>;
	isRanking: boolean;
	setIsRanking: React.Dispatch<React.SetStateAction<boolean>>;

	// Agent state
	agent: AgentState | null;
	setAgent: React.Dispatch<React.SetStateAction<AgentState | null>>;
	selectedSecondaries: string[];
	setSelectedSecondaries: React.Dispatch<React.SetStateAction<string[]>>;
	viewMode: 'outline' | 'blog' | 'markdown';
	setViewMode: React.Dispatch<
		React.SetStateAction<'outline' | 'blog' | 'markdown'>
	>;
	showOutline: boolean;
	setShowOutline: React.Dispatch<React.SetStateAction<boolean>>;

	// Form state
	interlinkKeyword: string;
	setInterlinkKeyword: React.Dispatch<React.SetStateAction<string>>;
	interlinkUrl: string;
	setInterlinkUrl: React.Dispatch<React.SetStateAction<string>>;
	currentReferenceUrl: string;
	setCurrentReferenceUrl: React.Dispatch<React.SetStateAction<string>>;
	completedSelections: Set<string>;
	setCompletedSelections: React.Dispatch<React.SetStateAction<Set<string>>>;

	// Refs
	scrollRef: React.RefObject<HTMLDivElement>;

	// Computed
	canSend: boolean;
	isInputLocked: boolean;
}

/**
 * Custom hook to manage all agent-related state
 * @param data - Initial blog data
 * @param apiKey - API key from data
 * @returns Object containing all state and setters
 */
export const useAgentState = (
	data: BlogData,
	apiKey: string
): UseAgentStateReturn => {
	// Flow context
	const [flowContext, setFlowContext] = useState<FlowContext>({
		automationLevel: 'guided',
		hasProvidedInfo: false,
		missingFields: [],
		awaitingConfirmation: false,
		currentStep: 'initial',
		modificationInProgress: false,
		userRequestedAutomation: false,
		pendingModificationRequest: null,
	});

	// Messages
	const [messages, setMessages] = useState<ChatMessage[]>([
		{
			role: 'assistant',
			content: `Hello! I'm your Blog Agent 🤖. `,
		},
	]);

	// Input
	const [input, setInput] = useState('');

	// Blog content
	const [draft, setDraft] = useState<string>(data.blogContent || '');
	const [userTopic, setUserTopic] = useState<string>(data.topic || '');
	const [targetLocation, setTargetLocation] = useState<string>(
		data.targetLocation || 'United States'
	);
	const [outline, setOutline] = useState<OutlineSection[]>(
		data.outline || []
	);
	const [outlineApproved, setOutlineApproved] = useState<boolean>(false);
	const [showBlogContent, setShowBlogContent] = useState<boolean>(
		!!(data.blogContent && data.blogContent.trim().length > 0)
	);

	// UI state
	const [isThinking, setIsThinking] = useState(false);
	const [isStreaming, setIsStreaming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [traceItems, setTraceItems] = useState<
		Array<{ step: string; at: number }>
	>([]);

	// SEO state
	const [seoScore, setSeoScore] = useState<number | null>(null);
	const [seoPrimary, setSeoPrimary] = useState<string>('');
	const [seoCritical, setSeoCritical] = useState<string>('');
	const [isRanking, setIsRanking] = useState(false);

	// Agent state
	const [agent, setAgent] = useState<AgentState | null>(null);
	const [selectedSecondaries, setSelectedSecondaries] = useState<string[]>(
		[]
	);
	const [viewMode, setViewMode] = useState<'outline' | 'blog' | 'markdown'>(
		'outline'
	);
	const [showOutline, setShowOutline] = useState(true);

	// Form state
	const [interlinkKeyword, setInterlinkKeyword] = useState('');
	const [interlinkUrl, setInterlinkUrl] = useState('');
	const [currentReferenceUrl, setCurrentReferenceUrl] = useState('');
	const [completedSelections, setCompletedSelections] = useState<
		Set<string>
	>(new Set());

	// Refs
	const scrollRef = useRef<HTMLDivElement>(null);

	// Computed values
	const canSend = useMemo(() => {
		if (!input.trim() || !apiKey) return false;
		if (outlineApproved) return false;
		if (isThinking || isStreaming) return false;
		return true;
	}, [input, apiKey, outlineApproved, isThinking, isStreaming]);

	const isInputLocked = outlineApproved || isThinking || isStreaming;

	return {
		flowContext,
		setFlowContext,
		messages,
		setMessages,
		input,
		setInput,
		draft,
		setDraft,
		userTopic,
		setUserTopic,
		targetLocation,
		setTargetLocation,
		outline,
		setOutline,
		outlineApproved,
		setOutlineApproved,
		showBlogContent,
		setShowBlogContent,
		isThinking,
		setIsThinking,
		isStreaming,
		setIsStreaming,
		error,
		setError,
		traceItems,
		setTraceItems,
		seoScore,
		setSeoScore,
		seoPrimary,
		setSeoPrimary,
		seoCritical,
		setSeoCritical,
		isRanking,
		setIsRanking,
		agent,
		setAgent,
		selectedSecondaries,
		setSelectedSecondaries,
		viewMode,
		setViewMode,
		showOutline,
		setShowOutline,
		interlinkKeyword,
		setInterlinkKeyword,
		interlinkUrl,
		setInterlinkUrl,
		currentReferenceUrl,
		setCurrentReferenceUrl,
		completedSelections,
		setCompletedSelections,
		scrollRef,
		canSend,
		isInputLocked,
	};
};

