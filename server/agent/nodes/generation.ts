import { AgentState } from '../state';
import * as agentService from '../../../services/agentService';
import * as geminiService from '../../../services/geminiService';
import * as automationEngine from '../../../services/automationEngine';
import { Interlink } from '../../../types';
import { getUserLanguage, getUserModel } from '../../../server/db/userService';

export type ProposalResult = {
	draft?: string;
	progress?: { sectionIndex: number };
	currentStep?: any;
	trace?: any[];
};

export const proposalNode = async (
	state: AgentState
): Promise<ProposalResult> => {
	if (!state.outlineApproved) return {};
	const idx = state.progress.sectionIndex ?? 0;
	// IMPORTANT: When the router is still on `currentStep: 'outline'`, it will keep routing
	// back to `proposal`. If we silently return {} here, the graph can loop forever.
	// Instead, advance the step to `generation` and clamp sectionIndex so the router can stop.
	if (idx >= state.outline.length) {
		return {
			currentStep: 'generation',
			progress: { sectionIndex: Math.min(idx, state.outline.length) },
		};
	}

	// ✨ Initialize draft with title on first section
	let currentDraft = state.draft;
	if (idx === 0 && (!currentDraft || currentDraft.trim() === '')) {
		currentDraft = `# ${state.data.title || 'Untitled'}\n\n`;
	}

	const section = state.outline[idx];

	// Get apiKey from environment variable first (preferred), then state
	// This allows the API key to be configured server-side via .env
	const apiKeyForSection =
		process.env.GEMINI_API_KEY ||
		process.env.OPENAI_API_KEY ||
		state.apiKey;
	if (!apiKeyForSection) {
		throw new Error(
			'API Key is required. Please set GEMINI_API_KEY or OPENAI_API_KEY in your .env file or provide apiKey in state.'
		);
	}

	// ✨ Fetch user language and model with fallback
	const userLanguage = await getUserLanguage(state.userId);
	const userModel = await getUserModel(state.userId);

	const sectionMd = await agentService.generateSectionContent(
		state.data,
		section,
		apiKeyForSection,
		{
			targetKeyword: state.data.primaryKeyword,
			interlinks: state.data.interlinks as Interlink[],
			referenceUrls: [],
			language: userLanguage, // ✨ Pass language parameter
			model: userModel, // ✨ Pass model parameter
		}
	);

	const newDraft = `${currentDraft}\n\n${sectionMd}`;

	return {
		draft: newDraft,
		progress: { sectionIndex: Math.min(idx + 1, state.outline.length) },
		currentStep: 'generation',
		trace: [
			{
				step: 'ProposalNode.generatedSection',
				info: { sectionIndex: idx, section: section.name },
				at: Date.now(),
			},
		],
	};
};

export type FinalBlogResult = {
	draft?: string;
	trace?: any[];
};

export const finalBlogGenerationNode = async (
	state: AgentState
): Promise<FinalBlogResult> => {
	if (!state.outlineApproved || !state.outline || state.outline.length === 0) return {};

	// Generate complete blog post using the approved outline
	// Note: In the original, this regenerates the WHOLE blog.
	// If we have been building it section by section in `draft`, we might just want to use that.
	// However, `geminiService.generateBlogPost` might do a final polish pass.
	// Let's stick to the original logic for now but be aware of the redundancy.

	// Get apiKey from environment variable first (preferred), then state
	// This allows the API key to be configured server-side via .env
	const apiKeyForBlog = process.env.GEMINI_API_KEY || state.apiKey;
	if (!apiKeyForBlog) {
		throw new Error(
			'API Key is required. Please set GEMINI_API_KEY in your .env file or provide apiKey in state.'
		);
	}
	const fullBlog = await geminiService.generateBlogPost(
		state.data,
		state.outline,
		apiKeyForBlog
	);

	return {
		draft: fullBlog,
		trace: [
			{
				step: 'FinalBlog.generated',
				info: { wordCount: fullBlog.split(/\s+/).length },
				at: Date.now(),
			},
		],
	};
};
