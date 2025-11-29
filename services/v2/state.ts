import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { BlogData, OutlineSection, AgentPreferences } from '../../types';

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
    halt: Annotation<{ reason: string } | null>({
        reducer: (x, y) => y,
        default: () => null,
    }),
});

export type AgentState = typeof AgentStateAnnotation.State;
