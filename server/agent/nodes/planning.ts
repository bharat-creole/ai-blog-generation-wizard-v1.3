import { AgentState, HaltState } from '../state';
import * as geminiService from '../../../services/geminiService';
import * as automationEngine from '../../../services/automationEngine';
import { BlogData, OutlineSection } from '../../../types';

export type TitleGenerationResult = {
    currentStep?: any;
    titleCandidates?: string[];
    autoSelectedTitle?: string | null;
    data?: Partial<AgentState['data']>;
    halt?: HaltState | null;
    titleOptions?: string[];
    messages?: any[];
    trace?: any[];
    toolOutputs?: any[];
};

export const titleGenerationNode = async (state: AgentState): Promise<TitleGenerationResult> => {
    if (!state.data.primaryKeyword?.trim()) return {};

    // ✨ Case 1: User already provided title
    if (automationEngine.isUserProvided(state as any, 'title') && state.data.title?.trim()) {
        return {
            currentStep: 'title',
            autoSelectedTitle: state.data.title,
            data: { title: state.data.title },
            trace: [{ step: 'TitleGeneration.userProvided', info: { title: state.data.title }, at: Date.now() }],
        };
    }

    // Generate title options using Gemini
    // Get apiKey from state or environment variable
    const apiKey = state.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('API Key is required. Please provide apiKey in state or set GEMINI_API_KEY in your .env.local file.');
    }

    // ✨ NEW: Fetch reference titles from web search for inspiration
    console.log('🔍 [TITLE GENERATION] Fetching reference titles from web search...');
    const topicForSearch = state.data.title || state.data.topic || state.data.primaryKeyword || '';
    let referenceTitles: string[] = [];

    if (topicForSearch) {
        try {
            referenceTitles = await geminiService.searchWebForTitles(topicForSearch, apiKey);
            console.log(`   ✅ Found ${referenceTitles.length} reference titles from web search`);
            if (referenceTitles.length > 0) {
                console.log(`   📋 Sample reference titles:`);
                referenceTitles.slice(0, 5).forEach((title, idx) => {
                    console.log(`      ${idx + 1}. ${title}`);
                });
            }
        } catch (err) {
            console.warn('   ⚠️  Failed to fetch reference titles, continuing without them:', err);
        }
    }

    // Generate titles with reference titles and feedback
    const titleFeedback = state.conversationContext?.titleFeedback;
    const titlesInput: BlogData = {
        apiKey,
        title: state.data.title || '',
        topic: state.data.topic || '',
        targetLocation: state.data.targetLocation || 'United States',
        primaryKeyword: state.data.primaryKeyword || '',
        secondaryKeywords: state.data.secondaryKeywords || [],
        suggestedTitles: state.data.suggestedTitles || [],
        referenceUrls: state.data.referenceUrls || [],
        referenceFiles: state.data.referenceFiles || [],
        interlinks: (state.data.interlinks as any) || [],
        brandVoice: state.data.brandVoice || '',
        blogGuideline: state.data.blogGuideline || '',
        llmModel: (state.data.llmModel as any) || 'gemini-flash-latest',
        language: state.data.language || 'en',
        outline: state.outline || [],
        blogContent: state.draft || '',
    };

    const titles = await geminiService.generateTitles(
        titlesInput,
        apiKey,
        titleFeedback,
        referenceTitles
    );

    // Clear feedback after using it to avoid repeated regeneration loops.
    // (User can provide new feedback later if they want another regeneration.)
    if (state.conversationContext?.titleFeedback) {
        state.conversationContext.titleFeedback = undefined;
    }

    // ✨ Case 2: Auto-select if automation enabled
    if (automationEngine.shouldAutoFill(state as any, 'title') && titles.length > 0) {
        return {
            currentStep: 'title',
            autoSelectedTitle: titles[0],
            data: { title: titles[0] },
            trace: [
                { step: 'TitleGeneration.generated', info: { count: titles.length }, at: Date.now() },
                { step: 'TitleGeneration.autoSelected', info: { title: titles[0] }, at: Date.now() }
            ]
        };
    }

    // ✨ Case 3: Show options to user (default behavior)
    return {
        titleCandidates: titles,
        // Persist to common state fields used by different UI paths.
        // The router stops execution when `halt` is set.
        halt: { reason: 'await_title_selection' },
        titleOptions: titles,
        toolOutputs: [{
            type: 'title_options',
            data: { titles },
            timestamp: Date.now(),
        }],
        trace: [{ step: 'TitleGeneration.generated', info: { count: titles.length }, at: Date.now() }]
    };
};

export type DiscoveryResult = {
    outline?: any[];
    draft?: string;
    outlineApproved?: boolean;
    halt?: any;
    currentStep?: any;
    messages?: any[];
    trace?: any[];
    toolOutputs?: any[];
    needsApproval?: boolean;
};

export const discoveryNode = async (state: AgentState): Promise<DiscoveryResult> => {
    const shouldUseRefs =
        state.preferences.automationLevel === 'full' || // Simplify logic for v2
        state.data.referenceUrls?.length > 0;

    // 📚 Log reference materials being used for outline
    if (shouldUseRefs) {
        console.log('📚 [OUTLINE GENERATION] Using references:');
        console.log(`   URLs: ${state.data.referenceUrls?.length || 0}`);
        console.log(`   Files: ${state.data.referenceFiles?.length || 0}`);
    }

    // ✨ Check if user provided feedback for outline regeneration
    // Note: In V2, we might handle feedback differently, but keeping logic similar for now
    // We assume feedback comes in via state updates before this node runs

    console.log('📝 [OUTLINE GENERATION] Creating initial outline...');
    // Get apiKey from environment variable first (preferred), then state
    // This allows the API key to be configured server-side via .env
    const apiKeyForOutline = process.env.GEMINI_API_KEY || state.apiKey;
    if (!apiKeyForOutline) {
        throw new Error('API Key is required. Please set GEMINI_API_KEY in your .env file or provide apiKey in state.');
    }

    const input: BlogData = {
        apiKey: apiKeyForOutline,
        title: state.data.title || '',
        topic: state.data.topic || '',
        targetLocation: state.data.targetLocation || 'United States',
        primaryKeyword: state.data.primaryKeyword || '',
        secondaryKeywords: state.data.secondaryKeywords || [],
        suggestedTitles: state.data.suggestedTitles || [],
        referenceUrls: shouldUseRefs ? (state.data.referenceUrls || []) : [],
        referenceFiles: shouldUseRefs ? (state.data.referenceFiles || []) : [],
        interlinks: (state.data.interlinks as any) || [],
        brandVoice: state.data.brandVoice || '',
        blogGuideline: state.data.blogGuideline || '',
        llmModel: (state.data.llmModel as any) || 'gemini-flash-latest',
        language: state.data.language || 'en',
        outline: [],
        blogContent: '',
    };
    const outline = await geminiService.generateOutline(input, apiKeyForOutline);

    // Sanitize outline: Gemini (or UI editing) can sometimes introduce empty/placeholder H2s.
    // If those make it into state, section-by-section generation can attempt an extra section.
    const sanitizedOutline = (Array.isArray(outline) ? outline : [])
        .filter((s: any) => s && typeof s === 'object')
        .filter((s: any) => typeof s.name === 'string' && s.name.trim().length > 0);

    console.log(`✅ [OUTLINE GENERATION] Complete! Outline has ${sanitizedOutline.length} sections`);

    return {
        outline: sanitizedOutline,
        draft: '',
        outlineApproved: false,
        needsApproval: true,
        halt: { reason: 'awaiting_approval' },
        currentStep: 'outline',
        toolOutputs: [{
            type: 'outline_generated',
            data: { outline: sanitizedOutline, sectionCount: sanitizedOutline.length },
            timestamp: Date.now(),
        }],
        trace: [{ step: 'DiscoveryNode.generatedOutline', info: { h2Count: sanitizedOutline.length }, at: Date.now() }]
    };
};
