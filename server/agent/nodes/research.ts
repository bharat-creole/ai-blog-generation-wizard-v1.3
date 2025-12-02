import { AgentState } from '../state';
import * as keywordTool from '../../../services/keywordService';
import * as automationEngine from '../../../services/automationEngine';
import * as geminiService from '../../../services/geminiService';
import { AIMessage } from '@langchain/core/messages';

export const researchPrimaryNode = async (
	state: AgentState
): Promise<Partial<AgentState>> => {
	// ✨ VALIDATION: Check if topic is valid before proceeding
	if (state.data.topic) {
		// Helper function to check if topic is gibberish
		const isGibberish = (text: string): boolean => {
			if (!text || text.trim().length < 3) return false;
			const trimmed = text.trim();
			const vowels = (trimmed.match(/[aeiouAEIOU]/g) || []).length;
			const consonants = (trimmed.match(/[bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ]/g) || []).length;
			const totalLetters = vowels + consonants;
			if (totalLetters === 0) return true;
			const vowelRatio = vowels / totalLetters;
			if (vowelRatio < 0.15 && trimmed.length > 8) return true;
			const hasRepeatedPattern = /(.{2,})\1{2,}/.test(trimmed);
			if (hasRepeatedPattern && trimmed.length > 10) return true;
			return false;
		};
		
		const isValidTopic = (topic: string): boolean => {
			if (!topic || !topic.trim() || topic.trim().length < 3) return false;
			const trimmed = topic.trim();
			const invalidPatterns = [
				/^[^a-zA-Z]*$/,
				/^(blog|it|yourself|everything|anything|something|whatever|random)$/i,
			];
			for (const pattern of invalidPatterns) {
				if (pattern.test(trimmed)) return false;
			}
			return true;
		};
		
		if (isGibberish(state.data.topic) || !isValidTopic(state.data.topic)) {
			return {
				halt: { reason: 'invalid_topic' },
				messages: [
					...(state.messages || []),
					new AIMessage(
						"I couldn't understand that topic. Please provide a clear, meaningful blog topic.\n\n**Examples:**\n- 'Cloud computing'\n- 'Machine learning'\n- 'Web development best practices'"
					),
				],
				trace: [
					{
						step: 'KeywordResearch.invalidTopic',
						info: { topic: state.data.topic },
						at: Date.now(),
					},
				],
			};
		}
	}
	
	// ✨ Case 1: User already provided keyword AND it exists
	if (
		automationEngine.isUserProvided(state as any, 'primaryKeyword') &&
		state.data.primaryKeyword
	) {
		return {
			currentStep: 'primary_keyword',
			trace: [
				{
					step: 'KeywordResearch.userProvided',
					info: { keyword: state.data.primaryKeyword },
					at: Date.now(),
				},
			],
		};
	}

	// 🎯 Extract main topic from multiple sources
	const topicSource =
		state.data.title ||
		state.data.topic ||
		state.data.primaryKeyword ||
		'';

	if (!topicSource || topicSource.trim().length === 0) {
		return {
			halt: { reason: 'no_topic_provided' },
			currentStep: 'topic',
			messages: [
				...(state.messages || []),
				new AIMessage(
					"Please provide a topic or title to search for keywords."
				),
			],
			trace: [
				{
					step: 'KeywordResearch.noTopic',
					info: {},
					at: Date.now(),
				},
			],
		};
	}

	const location = state.data.targetLocation || 'United States';
	let ranked: any[] = [];

	try {
		// ✨ NEW FLOW: Step 1 - Search web through Gemini to get top 10 titles
		console.log('🔍 [PRIMARY KEYWORD RESEARCH] Step 1: Searching web for titles...');
		const apiKey = state.apiKey || process.env.GEMINI_API_KEY;
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
		console.log('🔍 [PRIMARY KEYWORD RESEARCH] Step 2: Extracting keywords from titles...');
		const extractedKeywords = keywordTool.extractKeywordsFromTitles(
			webTitles,
			50 // Extract 50 keywords to ensure we get 20+ after all filtering
		);
		console.log(`   ✅ Extracted ${extractedKeywords.length} keywords from titles`);
		console.log(`   📝 Extracted keywords: [${extractedKeywords.join(', ')}]`);

		// ✨ NEW FLOW: Step 2.5 - Filter meaningful keywords using LLM
		console.log('🔍 [PRIMARY KEYWORD RESEARCH] Step 2.5: Filtering meaningful keywords with LLM...');
		const meaningfulKeywords = await geminiService.filterMeaningfulKeywords(
			extractedKeywords,
			topicSource,
			apiKey
		);
		console.log(`   ✅ Filtered to ${meaningfulKeywords.length} meaningful keywords`);
		console.log(`   📝 Meaningful keywords: [${meaningfulKeywords.join(', ')}]`);

		// Combine with any user-provided primary keyword
		const keywordsToResearch = [
			...(state.data.primaryKeyword ? [state.data.primaryKeyword] : []),
			...meaningfulKeywords,
		];

		// ✨ NEW FLOW: Step 3 - Fetch volumes ONLY for keywords extracted from titles
		console.log('🔍 [PRIMARY KEYWORD RESEARCH] Step 3: Fetching volumes for extracted keywords only...');
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

		// Separate keywords with volumes and without volumes
		const keywordsWithVolume = keywordVolumes
			.filter((kw): kw is NonNullable<typeof kw> => kw !== null)
			.map((kw) => ({
				...kw,
				score: 0, // Will be scored below
			}));

		// If we don't have enough keywords with volumes, include some without volumes
		// (but only if they passed the LLM filter)
		const keywordsWithoutVolume = keywordVolumes
			.map((kw, idx) => kw === null ? keywordsToResearch[idx] : null)
			.filter((kw): kw is string => kw !== null);

		// Start with keywords that have volumes
		ranked = keywordsWithVolume;

		// Score the keywords based on relevance to topic
		ranked = keywordTool.scoreIdeas(
			ranked,
			state.data.title || state.data.topic || '',
			true // Prioritize relevance/intent over volume
		);

		// ✨ Filter: Keep only short keywords (2-3 words max) and prioritize relevance/intent
		ranked = ranked
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
			})
			.slice(0, 30); // Limit to top 30 relevant short keywords

		// ✨ Ensure we have at least 20 keywords
		// If we have fewer than 20, add keywords without volumes (they passed LLM filter)
		if (ranked.length < 20 && keywordsWithoutVolume.length > 0) {
			const missingCount = 20 - ranked.length;
			const additionalKeywords = keywordsWithoutVolume
				.filter((kw) => {
					const wordCount = kw.split(' ').length;
					return wordCount <= 3 && kw.length <= 40;
				})
				.slice(0, missingCount)
				.map((kw) => ({
					text: kw,
					volume: 0, // No volume data available
					difficulty: 0.5,
					source: 'seed' as const,
					score: 0.1, // Lower score since no volume
				}));
			ranked = [...ranked, ...additionalKeywords];
		}

		// Final limit: show at least 20, up to 30
		ranked = ranked.slice(0, Math.max(20, ranked.length));

		console.log(`✅ [PRIMARY KEYWORD RESEARCH] Complete! Found ${ranked.length} unique short keywords (2-3 words) with volumes`);
	} catch (err) {
		console.error('❌ [PRIMARY KEYWORD RESEARCH] Error:', err);
		// Silent error handling - will return empty ranked array
	}

	// ✨ NEW: Handle no keywords found
	if (ranked.length === 0) {
		return {
			halt: { reason: 'no_keywords_found' },
			currentStep: 'topic', // or some other appropriate step
			messages: [
				...(state.messages || []),
				new AIMessage(
					"I couldn't find any keywords for your topic. Would you like to try a different topic or provide a primary keyword yourself?"
				),
			],
			trace: [
				{
					step: 'KeywordResearch.noKeywordsFound',
					info: {},
					at: Date.now(),
				},
			],
		};
	}

	// ✨ Case 2: Auto-select if automation enabled
	if (
		automationEngine.shouldAutoFill(state as any, 'primaryKeyword') &&
		ranked.length > 0
	) {
		return {
			data: { ...state.data, primaryKeyword: ranked[0].text },
			currentStep: 'primary_keyword',
			trace: [
				{
					step: 'KeywordResearch.autoSelected',
					info: {
						keyword: ranked[0].text,
						score: ranked[0].score,
					},
					at: Date.now(),
				},
			],
		};
	}

	// ✨ Case 3: Show options to user (default behavior)
	// In LangGraph, we interrupt the graph execution here
	return {
		halt: { reason: 'await_keyword_selection' },
		keywordCandidates: ranked, // ✨ Store candidates for UI
		currentStep: 'primary_keyword',
		toolOutputs: [
			{
				type: 'keyword_options',
				data: { type: 'primary', candidates: ranked },
				timestamp: Date.now(),
			},
		],
		trace: [
			{
				step: 'KeywordResearch.primaryCandidates',
				info: { count: ranked.length },
				at: Date.now(),
			},
		],
	};
};

export const researchSecondaryNode = async (
	state: AgentState
): Promise<Partial<AgentState>> => {
	const primary = (state.data.primaryKeyword || '').trim();
	if (!primary) return {};

	// ✨ Case 1: User already provided secondary keywords AND they exist
	if (
		automationEngine.isUserProvided(
			state as any,
			'secondaryKeywords'
		) &&
		state.data.secondaryKeywords &&
		state.data.secondaryKeywords.length > 0
	) {
		return {
			trace: [
				{
					step: 'KeywordResearch.secondaryUserProvided',
					info: {
						count: state.data.secondaryKeywords.length,
					},
					at: Date.now(),
				},
			],
		};
	}

	const location = state.data.targetLocation || 'United States';
	let ranked: any[] = [];

	try {
		const ideas = await keywordTool.getKeywordIdeas(primary, location);
		const merged = keywordTool.dedupeMerge(ideas);
		ranked = keywordTool.scoreIdeas(
			merged,
			state.data.title || state.data.topic || ''
		);
	} catch (err) {
		// Silent error handling
	}

	// ✨ CRITICAL FIX: Filter out primary keyword from secondary candidates
	const filteredRanked = ranked.filter(
		(k) => k.text.toLowerCase() !== primary.toLowerCase()
	);

	// ✨ NEW: Handle no keywords found gracefully
	if (filteredRanked.length === 0) {
		return {
			currentStep: 'secondary_keywords',
			messages: [
				...(state.messages || []),
				new AIMessage(
					"I couldn't find any secondary keywords. I'll proceed with just the primary keyword for now."
				),
			],
			trace: [
				{
					step: 'KeywordResearch.noSecondaryKeywordsFound',
					info: {},
					at: Date.now(),
				},
			],
		};
	}

	// ✨ Case 2: Auto-select if automation enabled
	if (
		automationEngine.shouldAutoFill(
			state as any,
			'secondaryKeywords'
		) &&
		filteredRanked.length > 0
	) {
		return {
			data: {
				...state.data,
				secondaryKeywords: filteredRanked
					.slice(0, 5)
					.map((k) => k.text),
			},
			currentStep: 'secondary_keywords',
			trace: [
				{
					step: 'KeywordResearch.secondaryAutoSelected',
					info: { count: 5 },
					at: Date.now(),
				},
			],
		};
	}

	// ✨ Case 3: Show options to user
	return {
		halt: { reason: 'await_secondary_selection' },
		keywordCandidates: filteredRanked, // ✨ Now excludes primary keyword
		currentStep: 'secondary_keywords',
		toolOutputs: [
			{
				type: 'keyword_options',
				data: { type: 'secondary', candidates: filteredRanked },
				timestamp: Date.now(),
			},
		],
		trace: [
			{
				step: 'KeywordResearch.secondaryCandidates',
				info: { count: filteredRanked.length },
				at: Date.now(),
			},
		],
	};
};
