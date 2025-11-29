import { AgentState } from '../state';
import * as geminiService from '../../geminiService';
import * as automationEngine from '../../automationEngine';
import { BlogData, OutlineSection } from '../../../types';

export const titleGenerationNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    if (!state.data.primaryKeyword?.trim()) return {};

    // ✨ Case 1: User already provided title
    if (automationEngine.isUserProvided(state as any, 'title') && state.data.title?.trim()) {
        return {
            trace: [{ step: 'TitleGeneration.userProvided', info: { title: state.data.title }, at: Date.now() }]
        };
    }

    // Generate title options using Gemini
    const titles = await geminiService.generateTitles(state.data, state.apiKey);

    // ✨ Case 2: Auto-select if automation enabled
    if (automationEngine.shouldAutoFill(state as any, 'title') && titles.length > 0) {
        return {
            data: { ...state.data, title: titles[0] },
            trace: [{ step: 'TitleGeneration.autoSelected', info: { title: titles[0] }, at: Date.now() }]
        };
    }

    // ✨ Case 3: Show options to user (default behavior)
    return {
        halt: { reason: 'await_title_selection' },
        // Store options in state if we had a place for them, or rely on UI to fetch/display
        // For now, assume we might need to add `titleOptions` to schema
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
    const outline = await geminiService.generateOutline(input, state.apiKey);

    console.log(`✅ [OUTLINE GENERATION] Complete! Outline has ${outline.length} sections`);

    return {
        outline: outline,
        draft: '', // Clear draft
        outlineApproved: false,
        halt: { reason: 'awaiting_approval' }, // Always halt for approval
        trace: [{ step: 'DiscoveryNode.generatedOutline', info: { h2Count: outline.length }, at: Date.now() }]
    };
};
