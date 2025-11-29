import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { BlogData, OutlineSection, AgentPreferences, ConversationContext, ToolOutput } from '../../types';
import { KwRow } from '../keywordService';

export type ReferencesUsage = 'both' | 'outline-only' | 'content-only';

/**
 * Defines the state schema for the Blog Agent using LangGraph's Annotation system.
 * 
 * Channels:
 * - messages: Stores the conversation history (appended).
 * - blogData: Stores the core blog data (overwritten).
 * - outline: Stores the generated outline (overwritten).
 * - draft: Stores the current blog draft (overwritten).
 * - progress: Tracks execution progress (overwritten).
 * - preferences: Stores user automation preferences (overwritten).
 */
export const AgentStateAnnotation = Annotation.Root({
    // Chat history - appends new messages
    messages: Annotation<BaseMessage[]>({
        reducer: (x, y) => x.concat(y),
        default: () => [],
    }),

    // API Key - overwrites
    apiKey: Annotation<string>({
        reducer: (x, y) => y,
        default: () => '',
    }),

    // Blog data - overwrites with new data
    data: Annotation<BlogData>({
        reducer: (x, y) => ({ ...x, ...y }),
        default: () => ({} as BlogData),
    }),

    // Outline - overwrites
    outline: Annotation<OutlineSection[]>({
        reducer: (x, y) => y,
        default: () => [],
    }),

    // Outline approval status
    outlineApproved: Annotation<boolean>({
        reducer: (x, y) => y,
        default: () => false,
    }),

    // Current draft content
    draft: Annotation<string>({
        reducer: (x, y) => y,
        default: () => '',
    }),

    // Execution progress
    progress: Annotation<{ sectionIndex: number }>({
        reducer: (x, y) => y,
        default: () => ({ sectionIndex: 0 }),
    }),

    // User preferences
    preferences: Annotation<AgentPreferences>({
        reducer: (x, y) => ({ ...x, ...y }),
        default: () => ({
            automationLevel: 'guided',
            skipOptionalSteps: false,
            autoSelectBestOptions: false,
        }),
    }),

    // Policy for agent behavior (e.g., references usage, grounding)
    policy: Annotation<{ referencesUsage: ReferencesUsage; grounding: boolean }>({
        reducer: (x, y) => ({ ...x, ...y }),
        default: () => ({ referencesUsage: 'both', grounding: true }),
    }),

    // User provided fields tracking
    userProvidedFields: Annotation<Set<string>>({
        reducer: (x, y) => new Set([...x, ...y]),
        default: () => new Set(),
    }),

    // Auto-filled fields tracking
    autoFillFields: Annotation<Set<string>>({
        reducer: (x, y) => new Set([...x, ...y]),
        default: () => new Set(),
    }),

    // Trace for debugging/UI
    trace: Annotation<{ step: string; info?: any; at: number }[]>({
        reducer: (x, y) => x.concat(y),
        default: () => [],
    }),

    // Halt reason (if paused for user input)
    halt: Annotation<{ reason: 'await_keyword_selection' | 'await_secondary_selection' | 'await_title_selection' | 'await_interlinking_selection' | 'await_references_selection' | 'await_outline_start_confirmation' | 'awaiting_approval' | 'awaiting_automation_level_selection' | 'awaiting_blog_draft_approval' | 'await_auto_selection_confirmation' | string } | null>({
        reducer: (x, y) => y,
        default: () => null,
    }),

    // Keyword research data
    keywordResearch: Annotation<{
        primaryCandidates?: KwRow[];
        secondaryCandidates?: KwRow[];
        snapshot?: Record<string, any>;
    } | undefined>({
        reducer: (x, y) => ({ ...x, ...y }),
        default: () => undefined,
    }),

    // Title generation options
    titleOptions: Annotation<string[] | undefined>({
        reducer: (x, y) => y,
        default: () => undefined,
    }),

    // Flag if title has been explicitly selected/provided
    titleSelected: Annotation<boolean | undefined>({
        reducer: (x, y) => y,
        default: () => undefined,
    }),

    // Flag if interlinking step is completed
    interlinkingCompleted: Annotation<boolean | undefined>({
        reducer: (x, y) => y,
        default: () => undefined,
    }),

    // Flag if references collection step is completed
    referencesCollected: Annotation<boolean | undefined>({
        reducer: (x, y) => y,
        default: () => undefined,
    }),

    // Flag if final blog generation is done
    finalBlogGenerated: Annotation<boolean | undefined>({
        reducer: (x, y) => y,
        default: () => undefined,
    }),

    // User feedback for outline regeneration
    outlineFeedback: Annotation<string | undefined>({
        reducer: (x, y) => y,
        default: () => undefined,
    }),

    // Conversation context (e.g., for intent classification)
    conversationContext: Annotation<ConversationContext | undefined>({
        reducer: (x, y) => ({ ...x, ...y }),
        default: () => undefined,
    }),

    // Store candidates for UI selection
    keywordCandidates: Annotation<any[]>({
        reducer: (x, y) => y,
        default: () => [],
    }),

    titleCandidates: Annotation<string[]>({
        reducer: (x, y) => y,
        default: () => [],
    }),

    // Track current step for bidirectional navigation
    currentStep: Annotation<'topic' | 'primary_keyword' | 'secondary_keywords' | 'title' | 'interlinking' | 'references' | 'outline_confirmation' | 'outline' | 'generation'>({
        reducer: (x, y) => y,
        default: () => 'topic',
    }),

    // Store tool outputs for UI visibility
    toolOutputs: Annotation<ToolOutput[]>({
        reducer: (x, y) => x.concat(y),
        default: () => [],
    }),

    // Pending modification request (for confirmation flow)
    pendingModificationRequest: Annotation<string | undefined>({
        reducer: (x, y) => y,
        default: () => undefined,
    }),
});

export type AgentState = typeof AgentStateAnnotation.State;
