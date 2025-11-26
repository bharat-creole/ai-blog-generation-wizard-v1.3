import { AgentState } from './langgraph/agentGraph';
import * as keywordTool from './keywordService';
import * as geminiService from './geminiService';

export const autoFillPrimaryKeyword = async (
	s: AgentState
): Promise<string> => {
	const seeds = [
		...(s.data.primaryKeyword ? [s.data.primaryKeyword] : []),
		...keywordTool.extractSeedsFromTitle(
			s.data.title || s.data.topic || ''
		),
	];
	const location = s.data.targetLocation || 'United States';

	// 📊 LOG: Auto-fill primary keyword research
	console.log('🤖 [AUTO-FILL PRIMARY KEYWORD] Starting...');
	console.log(`   Seeds: [${seeds.join(', ')}]`);
	console.log(`   Location: ${location}`);

	try {
		const batches = await Promise.all(
			seeds.map(async (k, idx) => {
				console.log(`   📡 Fetching keywords for seed ${idx + 1}/${seeds.length}: "${k}"`);
				try {
					const results = await keywordTool.getKeywordIdeas(k, location);
					console.log(`   ✅ Got ${results.length} keywords for "${k}"`);
					return results;
				} catch (err) {
					console.error(`   ❌ Failed to fetch keywords for "${k}":`, err);
					return [];
				}
			})
		);

		const merged = keywordTool.dedupeMerge(batches.flat());
		const ranked = keywordTool.scoreIdeas(
			merged,
			s.data.title || s.data.topic || ''
		);

		// Auto-select the top-ranked keyword
		const selected = ranked.length > 0 ? ranked[0].text : s.data.topic || '';
		console.log(`✅ [AUTO-FILL PRIMARY KEYWORD] Selected: "${selected}"`);
		return selected;
	} catch (err) {
		console.error('❌ [AUTO-FILL PRIMARY KEYWORD] Failed:', err);
		return s.data.topic || '';
	}
};

export const autoFillSecondaryKeywords = async (
	s: AgentState
): Promise<string[]> => {
	const primary = s.data.primaryKeyword || '';
	if (!primary) {
		console.log('⚠️ [AUTO-FILL SECONDARY KEYWORDS] No primary keyword, skipping');
		return [];
	}

	const location = s.data.targetLocation || 'United States';

	// 📊 LOG: Auto-fill secondary keywords
	console.log('🤖 [AUTO-FILL SECONDARY KEYWORDS] Starting...');
	console.log(`   Primary Keyword: "${primary}"`);
	console.log(`   Location: ${location}`);

	try {
		console.log('   📡 Fetching secondary keywords...');
		const ideas = await keywordTool.getKeywordIdeas(primary, location);
		console.log(`   ✅ Got ${ideas.length} keyword ideas`);

		const merged = keywordTool.dedupeMerge(ideas);
		const ranked = keywordTool.scoreIdeas(
			merged,
			s.data.title || s.data.topic || ''
		);

		// Auto-select top 5 secondary keywords
		const selected = ranked.slice(0, 5).map((k) => k.text);
		console.log(`✅ [AUTO-FILL SECONDARY KEYWORDS] Selected ${selected.length} keywords: [${selected.join(', ')}]`);
		return selected;
	} catch (err) {
		console.error('❌ [AUTO-FILL SECONDARY KEYWORDS] Failed:', err);
		return [];
	}
};

export const autoFillTitle = async (s: AgentState): Promise<string> => {
	if (!s.data.primaryKeyword) {
		throw new Error('Primary keyword required to generate title');
	}

	const titles = await geminiService.generateTitles(s.data, s.apiKey);
	// Auto-select the first (best) title
	return titles.length > 0 ? titles[0] : s.data.topic || 'Untitled Blog';
};

export const shouldAutoFill = (
	s: AgentState,
	field: keyof typeof s.data
): boolean => {
	// Check if field is in autoFillFields set
	if (s.autoFillFields && s.autoFillFields.has(field)) {
		console.log(`🤖 [AUTO-FILL] Field "${field}" - auto-fill enabled (in autoFillFields set)`);
		return true;
	}

	// Check if full automation mode
	if (s.preferences?.automationLevel === 'full') {
		console.log(`🤖 [AUTO-FILL] Field "${field}" - auto-fill enabled (automation level: full)`);
		return true;
	}

	return false;
};

export const isUserProvided = (
	s: AgentState,
	field: string
): boolean => {
	return s.userProvidedFields
		? s.userProvidedFields.has(field)
		: false;
};

export const needsUserInput = (s: AgentState): boolean => {
	// ✨ ALWAYS require user input for outline approval regardless of automation mode
	if (s.halt?.reason === 'awaiting_approval') {
		return true;
	}

	// Don't need user input if in full automation mode (for other steps)
	if (s.preferences?.automationLevel === 'full') {
		return false;
	}

	// Need user input if halt reason indicates waiting for selection/approval
	const inputReasons = [
		'await_keyword_selection',
		'await_secondary_selection',
		'await_title_selection',
		'await_interlinking',
		'await_references',
	];

	return s.halt?.reason
		? inputReasons.includes(s.halt.reason)
		: false;
};

export const canSkipStep = (s: AgentState, step: string): boolean => {
	// Optional steps that can be skipped
	const optionalSteps = ['interlinking', 'references'];

	if (optionalSteps.includes(step)) {
		return (
			s.preferences?.skipOptionalSteps === true ||
			s.preferences?.automationLevel === 'full'
		);
	}

	return false;
};

