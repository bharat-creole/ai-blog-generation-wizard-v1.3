import { AgentState } from '../state';
import * as keywordTool from '../../../services/keywordService';
import * as automationEngine from '../../../services/automationEngine';
import { AIMessage } from '@langchain/core/messages';

export const researchPrimaryNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    // ✨ Case 1: User already provided keyword AND it exists
    if (automationEngine.isUserProvided(state as any, 'primaryKeyword') && state.data.primaryKeyword) {
        return {
            currentStep: 'primary_keyword',
            trace: [{ step: 'KeywordResearch.userProvided', info: { keyword: state.data.primaryKeyword }, at: Date.now() }]
        };
    }

    // 🎯 Extract main topic from multiple sources
    const topicSource = state.data.title || state.data.topic || state.data.primaryKeyword || '';

    // 🎯 Extract intelligent seeds using enhanced extraction
    const extractedSeeds = keywordTool.extractSeedsFromTitle(topicSource, 5);

    // Combine with any user-provided primary keyword
    const seeds = [
        ...(state.data.primaryKeyword ? [state.data.primaryKeyword] : []),
        ...extractedSeeds,
    ];

    const location = state.data.targetLocation || 'United States';
    let ranked: any[] = [];

    try {
        const batches = await Promise.all(
            seeds.map(async (k) => {
                try {
                    return await keywordTool.getKeywordIdeas(k, location);
                } catch (err) {
                    console.error(`❌ Failed to fetch keywords for "${k}":`, err);
                    return [];
                }
            })
        );

        const merged = keywordTool.dedupeMerge(batches.flat());
        ranked = keywordTool.scoreIdeas(merged, state.data.title || state.data.topic || '');
    } catch (err) {
        console.error('❌ [PRIMARY KEYWORD RESEARCH] Fatal error:', err);
    }

    // ✨ NEW: Handle no keywords found
    if (ranked.length === 0) {
        return {
            halt: { reason: 'no_keywords_found' },
            currentStep: 'topic', // or some other appropriate step
            messages: [...(state.messages || []), new AIMessage("I couldn't find any keywords for your topic. Would you like to try a different topic or provide a primary keyword yourself?")],
            trace: [{ step: 'KeywordResearch.noKeywordsFound', info: {}, at: Date.now() }]
        };
    }

    // ✨ Case 2: Auto-select if automation enabled
    if (automationEngine.shouldAutoFill(state as any, 'primaryKeyword') && ranked.length > 0) {
        return {
            data: { ...state.data, primaryKeyword: ranked[0].text },
            currentStep: 'primary_keyword',
            trace: [{ step: 'KeywordResearch.autoSelected', info: { keyword: ranked[0].text, score: ranked[0].score }, at: Date.now() }]
        };
    }

    // ✨ Case 3: Show options to user (default behavior)
    // In LangGraph, we interrupt the graph execution here
    return {
        halt: { reason: 'await_keyword_selection' },
        keywordCandidates: ranked, // ✨ Store candidates for UI
        currentStep: 'primary_keyword',
        toolOutputs: [{
            type: 'keyword_options',
            data: { type: 'primary', candidates: ranked },
            timestamp: Date.now(),
        }],
        trace: [{ step: 'KeywordResearch.primaryCandidates', info: { count: ranked.length }, at: Date.now() }]
    };
};

export const researchSecondaryNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const primary = (state.data.primaryKeyword || '').trim();
    if (!primary) return {};

    // ✨ Case 1: User already provided secondary keywords AND they exist
    if (
        automationEngine.isUserProvided(state as any, 'secondaryKeywords') &&
        state.data.secondaryKeywords &&
        state.data.secondaryKeywords.length > 0
    ) {
        return {
            trace: [{ step: 'KeywordResearch.secondaryUserProvided', info: { count: state.data.secondaryKeywords.length }, at: Date.now() }]
        };
    }

    const location = state.data.targetLocation || 'United States';
    let ranked: any[] = [];

    try {
        const ideas = await keywordTool.getKeywordIdeas(primary, location);
        const merged = keywordTool.dedupeMerge(ideas);
        ranked = keywordTool.scoreIdeas(merged, state.data.title || state.data.topic || '');
    } catch (err) {
        console.error('❌ [SECONDARY KEYWORD RESEARCH] Failed:', err);
    }

    // ✨ CRITICAL FIX: Filter out primary keyword from secondary candidates
    const filteredRanked = ranked.filter(k =>
        k.text.toLowerCase() !== primary.toLowerCase()
    );

    console.log(`🔍 [SECONDARY KEYWORDS] Filtered ${ranked.length - filteredRanked.length} duplicate(s) of primary keyword`);

    // ✨ NEW: Handle no keywords found gracefully
    if (filteredRanked.length === 0) {
        return {
            currentStep: 'secondary_keywords',
            messages: [...(state.messages || []), new AIMessage("I couldn't find any secondary keywords. I'll proceed with just the primary keyword for now.")],
            trace: [{ step: 'KeywordResearch.noSecondaryKeywordsFound', info: {}, at: Date.now() }]
        };
    }

    // ✨ Case 2: Auto-select if automation enabled
    if (automationEngine.shouldAutoFill(state as any, 'secondaryKeywords') && filteredRanked.length > 0) {
        return {
            data: { ...state.data, secondaryKeywords: filteredRanked.slice(0, 5).map((k) => k.text) },
            currentStep: 'secondary_keywords',
            trace: [{ step: 'KeywordResearch.secondaryAutoSelected', info: { count: 5 }, at: Date.now() }]
        };
    }

    // ✨ Case 3: Show options to user
    return {
        halt: { reason: 'await_secondary_selection' },
        keywordCandidates: filteredRanked, // ✨ Now excludes primary keyword
        currentStep: 'secondary_keywords',
        toolOutputs: [{
            type: 'keyword_options',
            data: { type: 'secondary', candidates: filteredRanked },
            timestamp: Date.now(),
        }],
        trace: [{ step: 'KeywordResearch.secondaryCandidates', info: { count: filteredRanked.length }, at: Date.now() }]
    };
};

