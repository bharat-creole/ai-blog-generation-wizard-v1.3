import { AgentState } from '../state';
import * as agentService from '../../../services/agentService';
import * as geminiService from '../../../services/geminiService';
import * as automationEngine from '../../../services/automationEngine';
import { Interlink } from '../../../types';

export const proposalNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    if (!state.outlineApproved) return {};
    const idx = state.progress.sectionIndex ?? 0;
    if (idx >= state.outline.length) return {};

    // ✨ Initialize draft with title on first section
    let currentDraft = state.draft;
    if (idx === 0 && (!currentDraft || currentDraft.trim() === '')) {
        currentDraft = `# ${state.data.title || 'Untitled'}\n\n`;
    }

    const section = state.outline[idx];
    const useRefs =
        state.preferences.automationLevel === 'full' || // Simplify logic for v2
        state.data.referenceUrls?.length > 0;

    // 📚 Log reference usage for this section
    if (useRefs && idx === 0) {
        console.log('📚 [CONTENT GENERATION] Using references:');
        console.log(`   URLs: ${state.data.referenceUrls?.length || 0}`);
        console.log(`   Files: ${state.data.referenceFiles?.length || 0}`);
    }

    // Get apiKey from state or environment variable
    const apiKeyForSection = state.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKeyForSection) {
        throw new Error('API Key is required. Please provide apiKey in state or set GEMINI_API_KEY in your .env.local file.');
    }
    const sectionMd = await agentService.generateSectionContent(
        state.data,
        section,
        apiKeyForSection,
        {
            targetKeyword: state.data.primaryKeyword,
            interlinks: state.data.interlinks as Interlink[],
            referenceUrls: useRefs ? state.data.referenceUrls : [],
        }
    );

    // Check for reference usage if required (simplified for v2)
    // In v2, we might want to make this a separate validation node or just log it
    if (useRefs && (state.data.referenceUrls?.length || 0) > 0) {
        const used =
            state.data.referenceUrls.some((u) => sectionMd.includes(u)) ||
            /\[[0-9]+\]/.test(sectionMd) ||
            /https?:\/\//.test(sectionMd);
        if (!used) {
            console.warn(`⚠️ [CONTENT GENERATION] References not detected in section "${section.name}"`);
            // In v2, we might want to retry or flag this, but for now we proceed
        }
    }

    const newDraft = `${currentDraft}\n\n${sectionMd}`;

    return {
        draft: newDraft,
        progress: { sectionIndex: idx + 1 },
        currentStep: 'generation', // ✨ Set step so router can track progress
        trace: [{ step: 'ProposalNode.generatedSection', info: { sectionIndex: idx, section: section.name }, at: Date.now() }]
    };
};

export const finalBlogGenerationNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    if (!state.outlineApproved || !state.outline || state.outline.length === 0) return {};

    // Generate complete blog post using the approved outline
    // Note: In the original, this regenerates the WHOLE blog. 
    // If we have been building it section by section in `draft`, we might just want to use that.
    // However, `geminiService.generateBlogPost` might do a final polish pass.
    // Let's stick to the original logic for now but be aware of the redundancy.

    // Get apiKey from state or environment variable
    const apiKeyForBlog = state.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKeyForBlog) {
        throw new Error('API Key is required. Please provide apiKey in state or set GEMINI_API_KEY in your .env.local file.');
    }
    const fullBlog = await geminiService.generateBlogPost(
        state.data,
        state.outline,
        apiKeyForBlog
    );

    return {
        draft: fullBlog, // Overwrite draft with final polished version
        // finalBlogGenerated: true, // We don't have this in schema yet, maybe add it?
        trace: [{ step: 'FinalBlog.generated', info: { wordCount: fullBlog.split(/\s+/).length }, at: Date.now() }]
    };
};
