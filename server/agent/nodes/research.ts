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
			const consonants = (
				trimmed.match(
					/[bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ]/g
				) || []
			).length;
			const totalLetters = vowels + consonants;
			if (totalLetters === 0) return true;
			const vowelRatio = vowels / totalLetters;
			if (vowelRatio < 0.15 && trimmed.length > 8) return true;
			const hasRepeatedPattern = /(.{2,})\1{2,}/.test(trimmed);
			if (hasRepeatedPattern && trimmed.length > 10) return true;
			return false;
		};

		const isValidTopic = (topic: string): boolean => {
			if (!topic || !topic.trim() || topic.trim().length < 3)
				return false;
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

		if (
			isGibberish(state.data.topic) ||
			!isValidTopic(state.data.topic)
		) {
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
					'Please provide a topic or title to search for keywords.'
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
		// ✨ NEW FLOW: Step 1 - Search web through Gemini to get top 5 URLs
		console.log(
			'🔍 [PRIMARY KEYWORD RESEARCH] Step 1: Searching web for top 5 URLs...'
		);
		const apiKey = state.apiKey || process.env.GEMINI_API_KEY;
		if (!apiKey) {
			throw new Error('API Key is required for web search.');
		}

		const webUrls = await geminiService.searchWebForUrls(
			topicSource,
			apiKey
		);
		console.log(`   ✅ Found ${webUrls.length} URLs from web search`);
		console.log(`   📋 Web-searched URLs:`);
		webUrls.forEach((url, idx) => {
			console.log(`      ${idx + 1}. ${url}`);
		});

		// ✨ NEW FLOW: Step 2 - Pass URLs to Google Keyword Research API
		console.log(
			'🔍 [PRIMARY KEYWORD RESEARCH] Step 2: Getting keywords from URLs via Google Keyword API...'
		);
		const keywordsFromUrls = await keywordTool.getKeywordsFromUrls(
			webUrls,
			location,
			topicSource
		);
		console.log(
			`   ✅ Got ${keywordsFromUrls.length} keywords from ${webUrls.length} URLs`
		);

		// ✨ NEW FLOW: Step 3 - Log all keywords (20 × 5 = 100), then filter to top 25 by user intent/relevancy
		console.log(
			'🔍 [PRIMARY KEYWORD RESEARCH] Step 3: Logging all keywords, then filtering to top 25 by user intent...'
		);

		// Log all keywords (20 × 5 = 100 max)
		console.log(
			`   📋 All ${keywordsFromUrls.length} keywords from ${webUrls.length} URLs (20 × ${webUrls.length}):`
		);
		keywordsFromUrls.forEach((kw, idx) => {
			console.log(
				`      ${idx + 1}. "${kw.text}" (Volume: ${
					kw.volume
				}, Difficulty: ${kw.difficulty})`
			);
		});

		// Score keywords based on user intent and relevancy
		// prioritizeRelevance: true means 50% relevance, 30% volume, 20% difficulty
		const scoredKeywords = keywordTool.scoreIdeas(
			keywordsFromUrls,
			topicSource,
			true // Prioritize relevance/intent over volume
		);

		// Filter out irrelevant keywords that don't match user intent
		const topicWords = new Set(
			(topicSource || '')
				.toLowerCase()
				.split(/\W+/)
				.filter((w) => w.length >= 3) // Only meaningful words (3+ chars)
		);

		// Generic phrases that should be filtered out (not topic-specific)
		const genericPhrases = [
			'difference between',
			'i have been',
			'your heart out',
			'heart of heart',
			'any difference',
			'define between',
			'difference between for',
			'difference between is',
			'difference between to',
		];

		// Filter function to check if keyword is relevant
		const isRelevantKeyword = (kw: any): boolean => {
			const kwText = kw.text.toLowerCase();

			// Filter out generic phrases
			if (
				genericPhrases.some((phrase) => kwText.includes(phrase))
			) {
				return false;
			}

			// Filter out keywords with very low relevance score (< 0.1)
			if (kw.score < 0.1) {
				return false;
			}

			// Filter out keywords that don't contain any topic words
			// (unless topic is too short/generic)
			if (topicWords.size > 0) {
				const kwWords = kwText
					.split(/\W+/)
					.filter((w: string) => w.length >= 3);
				const hasTopicWord = kwWords.some((kwWord: string) => {
					// Check exact match
					if (topicWords.has(kwWord)) return true;
					// Check if keyword word contains topic word or vice versa
					for (const topicWord of topicWords) {
						if (
							kwWord.includes(topicWord) ||
							topicWord.includes(kwWord)
						) {
							return true;
						}
					}
					return false;
				});

				if (!hasTopicWord) {
					return false;
				}
			}

			// Filter out single generic words (unless they're part of the topic)
			const words = kwText
				.split(/\s+/)
				.filter((w: string) => w.length >= 2);
			if (words.length === 1 && !topicWords.has(words[0])) {
				// Single word that's not in topic - likely generic
				return false;
			}

			return true;
		};

		// Apply relevance filtering
		const relevantKeywords = scoredKeywords.filter(isRelevantKeyword);

		// Filter to top 25 based on score (user intent + relevancy)
		ranked = relevantKeywords.slice(0, 25);

		console.log(
			`   🧹 Filtered out ${
				scoredKeywords.length - relevantKeywords.length
			} irrelevant keywords`
		);
		console.log(
			`   🎯 Top 25 keywords filtered by user intent and relevancy:`
		);
		ranked.forEach((kw: any, idx: number) => {
			console.log(
				`      ${idx + 1}. "${
					kw.text
				}" (Score: ${kw.score.toFixed(3)}, Volume: ${
					kw.volume
				}, Difficulty: ${kw.difficulty})`
			);
		});

		console.log(
			`✅ [PRIMARY KEYWORD RESEARCH] Complete! Filtered ${keywordsFromUrls.length} keywords → ${ranked.length} top keywords by user intent`
		);
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
					step: 'KeywordResearch.primaryCandidates',
					info: { count: ranked.length },
					at: Date.now(),
				},
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
					step: 'KeywordResearch.secondaryCandidates',
					info: { count: filteredRanked.length },
					at: Date.now(),
				},
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
