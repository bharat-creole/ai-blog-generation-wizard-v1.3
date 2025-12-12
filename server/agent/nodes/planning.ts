import { AgentState } from '../state';
import * as geminiService from '../../../services/geminiService';
import * as automationEngine from '../../../services/automationEngine';
import { BlogData, OutlineSection } from '../../../types';

export const titleGenerationNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    if (!state.data.primaryKeyword?.trim()) return {};

    // ✨ Case 1: User already provided title
    if (automationEngine.isUserProvided(state as any, 'title') && state.data.title?.trim()) {
        return {
            currentStep: 'title',
            trace: [{ step: 'TitleGeneration.userProvided', info: { title: state.data.title }, at: Date.now() }],
            halt: null, // Clear halt to proceed to the next step
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
    const titles = await geminiService.generateTitles(
        state.data, 
        apiKey, 
        titleFeedback,
        referenceTitles
    );

    // ✨ Case 2: Auto-select if automation enabled
    if (automationEngine.shouldAutoFill(state as any, 'title') && titles.length > 0) {
        return {
            data: { ...state.data, title: titles[0] },
            currentStep: 'title',
            trace: [
                { step: 'TitleGeneration.generated', info: { count: titles.length }, at: Date.now() },
                { step: 'TitleGeneration.autoSelected', info: { title: titles[0] }, at: Date.now() }
            ]
        };
    }

    // ✨ Case 3: Show options to user (default behavior)
    return {
        halt: { reason: 'await_title_selection' },
        titleCandidates: titles, // ✨ Store candidates for UI
        currentStep: 'title',
        toolOutputs: [{
            type: 'title_options',
            data: { titles },
            timestamp: Date.now(),
        }],
        trace: [{ step: 'TitleGeneration.generated', info: { count: titles.length }, at: Date.now() }]
    };
};

export const discoveryNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const shouldUseRefs =
        state.preferences.automationLevel === 'full' || // Simplify logic for v2
        state.data.referenceUrls?.length > 0;

    // 📚 Log reference materials being used for outline
    if (shouldUseRefs) {
        console.log('📚 [OUTLINE GENERATION] Using references:');
        console.log(`   URLs: ${state.data.referenceUrls?.length || 0}`);
        console.log(`   Files: ${state.data.referenceFiles?.length || 0}`);
    }

    const input: BlogData = {
        ...state.data,
        outline: [],
        referenceUrls: shouldUseRefs ? state.data.referenceUrls : [],
        referenceFiles: shouldUseRefs ? state.data.referenceFiles : [],
    } as BlogData;

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
    const outline = await geminiService.generateOutline(input, apiKeyForOutline);

    console.log(`✅ [OUTLINE GENERATION] Complete! Outline has ${outline.length} sections`);

    return {
        outline: outline,
        draft: '', // Clear draft
        outlineApproved: false,
        currentStep: 'outline',
        halt: { reason: 'awaiting_approval' }, // Always halt for approval
        toolOutputs: [{
            type: 'outline_generated',
            data: { outline, sectionCount: outline.length },
            timestamp: Date.now(),
        }],
        trace: [{ step: 'DiscoveryNode.generatedOutline', info: { h2Count: outline.length }, at: Date.now() }]
    };
};
