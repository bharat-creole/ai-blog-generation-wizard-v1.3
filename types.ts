export enum AppView {
    Agent,
}


export interface ReferenceFile {
    name: string;
    mimeType: string;
    base64: string;
}

export interface Interlink {
    id: string;
    keyword: string;
    url: string;
}

export interface OutlineItem {
    id: string;
    name: string;
}

export interface OutlineSection {
    id: string;
    name: string;
    items: OutlineItem[];
}

export interface BlogData {
    apiKey: string;
    title: string;
    topic: string;
    targetLocation: string;
    primaryKeyword: string;
    secondaryKeywords: string[];
    suggestedTitles: string[];
    referenceUrls: string[];
    referenceFiles: ReferenceFile[];
    interlinks: Interlink[];
    brandVoice: string;
    blogGuideline: string;
    llmModel: 'gemini-flash-latest';
    language: string;
    outline: OutlineSection[];
    blogContent: string;
    extractedHeadings?: string[];
    extractedHeadingsByFile?: { name: string; headings: string[] }[];
}



// Agent Mode Types
export type AutomationLevel = 'full' | 'guided' | 'manual';

export interface AgentPreferences {
    automationLevel: AutomationLevel;
    skipOptionalSteps: boolean;
    autoSelectBestOptions: boolean;
}

export interface ConversationContext {
    lastIntent: string;
    pendingQuestions: string[];
    titleFeedback?: string; // User feedback for title regeneration
    primaryKeywordFeedback?: string; // User feedback for primary keyword regeneration
    secondaryKeywordFeedback?: string; // User feedback for secondary keyword regeneration
    awaitingConfirmation?: boolean; // Whether we're waiting for user confirmation
    modificationRequest?: string; // What the user wants to modify (e.g., "primary keyword", "title")
}

export interface KeywordCandidate {
    text: string;
    volume: number;
    difficulty: number;
}

export interface ToolOutput {
    type: 'keyword_options' | 'title_options' | 'outline_generated';
    data: any;
    timestamp: number;
}

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    keywordSelection?: {
        type: 'primary' | 'secondary';
        candidates: KeywordCandidate[];
    };
    titleSelection?: {
        titles: string[];
    };
    interlinkingForm?: {
        currentLinks: Interlink[];
    };
    referencesForm?: {
        currentUrls: string[];
        currentFiles: ReferenceFile[];
    };
    outlineApproval?: {
        outline: OutlineSection[];
    };
    controlLevelSelection?: boolean;
}
