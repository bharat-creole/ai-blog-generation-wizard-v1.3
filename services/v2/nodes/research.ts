import { AgentState } from '../state';
import * as keywordTool from '../../keywordService';
import * as automationEngine from '../../automationEngine';

export const researchPrimaryNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    // ✨ Case 1: User already provided keyword
    if (automationEngine.isUserProvided(state as any, 'primaryKeyword')) {
        return {
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

    // ✨ Case 2: Auto-select if automation enabled
    if (automationEngine.shouldAutoFill(state as any, 'primaryKeyword') && ranked.length > 0) {
        return {
            data: { ...state.data, primaryKeyword: ranked[0].text },
            trace: [{ step: 'KeywordResearch.autoSelected', info: { keyword: ranked[0].text, score: ranked[0].score }, at: Date.now() }]
        };
    }

    // ✨ Case 3: Show options to user (default behavior)
    // In LangGraph, we interrupt the graph execution here
    return {
        halt: { reason: 'await_keyword_selection' },
        // Store candidates in specific part of state if needed, or just rely on the fact they are computed
        // For now, we might need to add a place to store candidates in the state schema if we want to present them
        // Let's assume we add `keywordCandidates` to the schema later.
        trace: [{ step: 'KeywordResearch.primaryCandidates', info: { count: ranked.length }, at: Date.now() }]
    };
};

export const researchSecondaryNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const primary = (state.data.primaryKeyword || '').trim();
    if (!primary) return {};

    // ✨ Case 1: User already provided secondary keywords
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

    // ✨ Case 2: Auto-select if automation enabled
    if (automationEngine.shouldAutoFill(state as any, 'secondaryKeywords') && ranked.length > 0) {
        return {
            data: { ...state.data, secondaryKeywords: ranked.slice(0, 5).map((k) => k.text) },
            trace: [{ step: 'KeywordResearch.secondaryAutoSelected', info: { count: 5 }, at: Date.now() }]
        };
    }

    // ✨ Case 3: Show options to user
    return {
        halt: { reason: 'await_secondary_selection' },
        trace: [{ step: 'KeywordResearch.secondaryCandidates', info: { count: ranked.length }, at: Date.now() }]
    };
};
