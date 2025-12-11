import { AgentState } from '../server/agent/state';
import * as keywordTool from './keywordService';
import * as geminiService from './geminiService';

export const autoFillPrimaryKeyword = async (
	s: AgentState
): Promise<string> => {
	const topicSource = s.data.title || s.data.topic || s.data.primaryKeyword || '';
	
	if (!topicSource || topicSource.trim().length === 0) {
		console.log('⚠️ [AUTO-FILL PRIMARY KEYWORD] No topic provided');
		return '';
	}

	const location = s.data.targetLocation || 'United States';

	// 📊 LOG: Auto-fill primary keyword research
	console.log('🤖 [AUTO-FILL PRIMARY KEYWORD] Starting...');
	console.log(`   Topic: "${topicSource}"`);
	console.log(`   Location: ${location}`);

	try {
		// ✨ NEW FLOW: Step 1 - Search web through Gemini to get top 10 titles
		console.log('   🔍 Step 1: Searching web for titles...');
		const apiKey = s.apiKey || process.env.GEMINI_API_KEY;
		if (!apiKey) {
			throw new Error('API Key is required for web search.');
		}

		const webTitles = await geminiService.searchWebForTitles(
			topicSource,
			apiKey
		);
		console.log(`   ✅ Found ${webTitles.length} titles from web search`);
		console.log(`   📋 Web-searched titles:`);
		webTitles.forEach((title, idx) => {
			console.log(`      ${idx + 1}. ${title}`);
		});

		// ✨ NEW FLOW: Step 2 - Extract relevant keywords from those titles
		console.log('   🔍 Step 2: Extracting keywords from titles...');
		const extractedKeywords = keywordTool.extractKeywordsFromTitles(
			webTitles,
			50 // Extract 50 keywords to ensure we get 20+ after all filtering
		);
		console.log(`   ✅ Extracted ${extractedKeywords.length} keywords from titles`);
		console.log(`   📝 Extracted keywords: [${extractedKeywords.join(', ')}]`);

		// ✨ NEW FLOW: Step 2.5 - Filter meaningful keywords using LLM
		console.log('   🔍 Step 2.5: Filtering meaningful keywords with LLM...');
		const meaningfulKeywords = await geminiService.filterMeaningfulKeywords(
			extractedKeywords,
			topicSource,
			apiKey
		);
		console.log(`   ✅ Filtered to ${meaningfulKeywords.length} meaningful keywords`);
		console.log(`   📝 Meaningful keywords: [${meaningfulKeywords.join(', ')}]`);

		// Combine with any user-provided primary keyword
		const keywordsToResearch = [
			...(s.data.primaryKeyword ? [s.data.primaryKeyword] : []),
			...meaningfulKeywords,
		];

		// ✨ NEW FLOW: Step 3 - Fetch volumes ONLY for keywords extracted from titles
		console.log('   🔍 Step 3: Fetching volumes for extracted keywords only...');
		const keywordVolumes = await Promise.all(
			keywordsToResearch.map(async (k, idx) => {
				try {
					console.log(`   📡 Fetching volume for keyword ${idx + 1}/${keywordsToResearch.length}: "${k}"`);
					const result = await keywordTool.getKeywordVolume(k, location);
					if (result) {
						console.log(`   ✅ Found volume for "${k}": ${result.volume}`);
						return result;
					} else {
						console.log(`   ⚠️  No volume found for "${k}"`);
						return null;
					}
				} catch (err) {
					console.error(`   ❌ Failed to fetch volume for "${k}":`, err);
					return null;
				}
			})
		);

		// Filter out null results (keywords without volumes)
		const ranked = keywordVolumes
			.filter((kw): kw is NonNullable<typeof kw> => kw !== null)
			.map((kw) => ({
				...kw,
				score: 0, // Will be scored below
			}));

		// Score the keywords based on relevance to topic
		const scoredRanked = keywordTool.scoreIdeas(
			ranked,
			s.data.title || s.data.topic || '',
			true // Prioritize relevance/intent over volume
		);

		// ✨ Filter: Keep only short keywords (2-3 words max) and prioritize relevance/intent
		const filteredRanked = scoredRanked
			.filter((kw) => {
				const wordCount = kw.text.split(' ').length;
				return wordCount <= 3 && kw.text.length <= 40; // Max 3 words, max 40 chars
			})
			.sort((a, b) => {
				// First sort by score (descending) - score prioritizes relevance/intent
				if (b.score !== a.score) {
					return b.score - a.score;
				}
				// Then by volume (descending) - as secondary factor
				if (b.volume !== a.volume) {
					return b.volume - a.volume;
				}
				// Then prefer 2-word keywords over 3-word, then 1-word
				const aWords = a.text.split(' ').length;
				const bWords = b.text.split(' ').length;
				if (aWords !== bWords) {
					if (aWords === 2) return -1;
					if (bWords === 2) return 1;
					if (aWords === 3) return -1;
					if (bWords === 3) return 1;
					return aWords - bWords;
				}
				return 0;
			});

		// Auto-select the top-ranked short keyword
		const selected = filteredRanked.length > 0 ? filteredRanked[0].text : s.data.topic || '';
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

	// Get apiKey from state or environment variable
	const apiKey = s.apiKey || process.env.GEMINI_API_KEY;
	if (!apiKey) {
		throw new Error('API Key is required. Please provide apiKey in state or set GEMINI_API_KEY in your .env.local file.');
	}

	// ✨ NEW: Fetch reference titles from web search for inspiration
	console.log('🔍 [AUTO-FILL TITLE] Fetching reference titles from web search...');
	const topicForSearch = s.data.title || s.data.topic || s.data.primaryKeyword || '';
	let referenceTitles: string[] = [];
	
	if (topicForSearch) {
		try {
			referenceTitles = await geminiService.searchWebForTitles(topicForSearch, apiKey);
			console.log(`   ✅ Found ${referenceTitles.length} reference titles from web search`);
		} catch (err) {
			console.warn('   ⚠️  Failed to fetch reference titles, continuing without them:', err);
		}
	}

	const titles = await geminiService.generateTitles(s.data, apiKey, undefined, referenceTitles);
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

