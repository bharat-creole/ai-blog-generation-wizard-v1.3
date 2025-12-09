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
		// ✨ NEW: Check for regeneration feedback
		const feedback = state.conversationContext?.primaryKeywordFeedback;
		const isRegeneration = !!feedback;

		// ✨ NEW FLOW: Step 1 - Search web through Gemini to get top 5 URLs
		// If regenerating with feedback, modify search query to incorporate feedback
		const searchQuery =
			isRegeneration && feedback
				? `${topicSource} ${feedback}` // Include feedback in search to get different URLs
				: topicSource;

		console.log(
			`🔍 [PRIMARY KEYWORD RESEARCH] Step 1: Searching web for top 5 URLs...${
				isRegeneration ? ' (REGENERATION WITH FEEDBACK)' : ''
			}`
		);
		if (isRegeneration && feedback) {
			console.log(`   📝 Feedback: "${feedback}"`);
			console.log(`   🔍 Modified search query: "${searchQuery}"`);
		}

		const apiKey = state.apiKey || process.env.GEMINI_API_KEY;
		if (!apiKey) {
			throw new Error('API Key is required for web search.');
		}

		const webUrls = await geminiService.searchWebForUrls(
			searchQuery, // Use modified query if regenerating
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
		let scoredKeywords = keywordTool.scoreIdeas(
			keywordsFromUrls,
			topicSource,
			true // Prioritize relevance/intent over volume
		);

		// ✨ NEW: If regeneration with feedback, use Gemini to generate NEW keywords
		if (isRegeneration && feedback) {
			console.log(
				`   🔄 [KEYWORD REGENERATION] Generating NEW keywords based on feedback: "${feedback}"`
			);
			try {
				// Generate completely new keywords based on feedback
				const newKeywords =
					await geminiService.filterKeywordsWithFeedback(
						scoredKeywords.slice(0, 50), // Pass some context keywords for reference
						topicSource,
						feedback,
						apiKey
					);

				if (newKeywords && newKeywords.length > 0) {
					console.log(
						`   ✅ [KEYWORD REGENERATION] Generated ${newKeywords.length} NEW keywords based on feedback`
					);

					// Re-score the new keywords with the feedback in mind
					const newScored = keywordTool.scoreIdeas(
						newKeywords,
						`${topicSource} ${feedback}`, // Include feedback in scoring context
						true
					);

					// Use the new keywords as the primary source
					scoredKeywords = newScored;

					// If we still need more, merge with some original keywords (but prioritize new ones)
					if (scoredKeywords.length < 25) {
						const newMap = new Map(
							scoredKeywords.map((kw) => [
								kw.text.toLowerCase(),
								kw,
							])
						);

						// Add original keywords that aren't duplicates
						keywordsFromUrls.forEach((kw) => {
							if (
								!newMap.has(
									kw.text.toLowerCase()
								) &&
								scoredKeywords.length < 50
							) {
								// Add score property to match expected type
								scoredKeywords.push({
									...kw,
									score: 0,
								} as any);
							}
						});

						// Re-score the merged list
						scoredKeywords = keywordTool.scoreIdeas(
							scoredKeywords,
							`${topicSource} ${feedback}`,
							true
						);
					}

					console.log(
						`   ✅ [KEYWORD REGENERATION] Using ${
							scoredKeywords.length
						} keywords (${newScored.length} new + ${
							scoredKeywords.length -
							newScored.length
						} merged)`
					);

					// Clear feedback after using it
					if (state.conversationContext) {
						state.conversationContext.primaryKeywordFeedback =
							undefined;
					}
				} else {
					console.log(
						`   ⚠️  [KEYWORD REGENERATION] No new keywords generated, using filtered original keywords`
					);
				}
			} catch (err) {
				console.error(
					'   ⚠️  [KEYWORD REGENERATION] Failed to generate new keywords with feedback:',
					err
				);
				// Continue with original keywords if regeneration fails
			}
		}

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
		// scoreThreshold: minimum matching score (0.0 to 1.0)
		const isRelevantKeyword = (
			kw: any,
			scoreThreshold: number = 0.3
		): boolean => {
			const kwText = kw.text.toLowerCase();

			// Filter out generic phrases
			if (
				genericPhrases.some((phrase) => kwText.includes(phrase))
			) {
				return false;
			}

			// Filter out keywords with relevance score below threshold (default 30%)
			if (kw.score < scoreThreshold) {
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

		// Apply relevance filtering with 30% threshold (preferred)
		let relevantKeywords = scoredKeywords.filter((kw) =>
			isRelevantKeyword(kw, 0.3)
		);

		// Sort all keywords by score (descending) to prioritize higher-scored ones
		scoredKeywords.sort((a, b) => b.score - a.score);

		// Ensure at least 25 keywords are shown, regardless of matching score
		if (relevantKeywords.length < 25) {
			console.log(
				`   ⚠️  Only found ${relevantKeywords.length} keywords with 30%+ score. Including more keywords to reach at least 25...`
			);

			// Take top 25 from all scored keywords (sorted by score)
			// This ensures we always have 25, prioritizing higher scores
			ranked = scoredKeywords.slice(0, 25);

			console.log(
				`   ✅ Showing ${ranked.length} keywords (top ${relevantKeywords.length} with 30%+ score, rest with lower scores)`
			);
		} else {
			// We have enough with 30%+ threshold, use those
			ranked = relevantKeywords.slice(0, 25);
			console.log(
				`   ✅ Found ${ranked.length} keywords with 30%+ matching score`
			);
		}

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

/**
 * Clean primary keyword by removing common prefixes
 */
const cleanPrimaryKeyword = (keyword: string): string => {
	if (!keyword) return '';

	let cleaned = keyword.trim();

	// Remove "primary keyword:" prefix (case insensitive, with or without colon)
	cleaned = cleaned.replace(/^primary\s+keyword\s*:?\s*/i, '');

	// Remove "keyword:" prefix (case insensitive, with or without colon)
	cleaned = cleaned.replace(/^keyword\s*:?\s*/i, '');

	// Remove "primary keyword" phrase at the start (without colon)
	// This handles cases like "primary keyword ai agent"
	if (cleaned.toLowerCase().startsWith('primary keyword ')) {
		cleaned = cleaned.substring('primary keyword '.length);
	}

	// Remove any leading/trailing whitespace
	cleaned = cleaned.trim();

	return cleaned;
};

export const researchSecondaryNode = async (
	state: AgentState
): Promise<Partial<AgentState>> => {
	const rawPrimary = (state.data.primaryKeyword || '').trim();
	if (!rawPrimary) return {};

	// ✨ CRITICAL: Clean the primary keyword to remove any prefixes
	const primary = cleanPrimaryKeyword(rawPrimary);

	if (!primary) {
		console.error(
			'❌ [SECONDARY KEYWORD RESEARCH] Primary keyword is empty after cleaning'
		);
		return {};
	}

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
	let ideas: any[] = []; // Store ideas for potential additional fetching

	console.log(
		`🔍 [SECONDARY KEYWORD RESEARCH] Using primary keyword: "${primary}" (cleaned from: "${rawPrimary}")`
	);

	try {
		// ✨ SIMPLIFIED: Directly use cleaned primary keyword with Google Keyword API
		console.log(
			`   📡 Calling Google Keyword API with seed: "${primary}", location: "${location}"`
		);

		ideas = await keywordTool.getKeywordIdeas(primary, location);

		console.log(
			`   📥 Received ${ideas?.length || 0} raw keywords from API`
		);

		if (!ideas || ideas.length === 0) {
			console.warn(
				`   ⚠️  [SECONDARY KEYWORD] No keywords returned from API for "${primary}"`
			);
		} else {
			// Log first few keywords for debugging
			console.log(
				`   📋 Sample keywords: [${ideas
					.slice(0, 5)
					.map((k: any) => k.text)
					.join(', ')}...]`
			);
		}

		// Dedupe and merge
		const merged = keywordTool.dedupeMerge(ideas || []);

		console.log(
			`   🔄 After deduplication: ${merged.length} unique keywords`
		);

		// Score keywords with context - prioritize relevance/intent to primary keyword
		ranked = keywordTool.scoreIdeas(
			merged,
			primary, // Use primary keyword as context for intent filtering
			true // Prioritize relevance/intent over volume
		) as any[]; // Type assertion: scoreIdeas returns KwRow & { score: number }[]

		console.log(
			`✅ [SECONDARY KEYWORD RESEARCH] Found ${ranked.length} keywords from Google Keyword API (after scoring)`
		);

		if (ranked.length === 0) {
			console.error(
				`   ❌ [SECONDARY KEYWORD] No keywords after scoring. Raw ideas: ${
					ideas?.length || 0
				}, Merged: ${merged.length}`
			);
		}
	} catch (err) {
		console.error('❌ [SECONDARY KEYWORD RESEARCH] Failed:', err);
		console.error(
			'   Error details:',
			err instanceof Error ? err.message : String(err)
		);
	}

	// ✨ CRITICAL FIX: Filter out primary keyword from secondary candidates
	const filteredRanked = ranked.filter(
		(k) => k.text.toLowerCase() !== primary.toLowerCase()
	);

	// ✨ NEW: Sort by score (descending) to get best keywords first
	filteredRanked.sort((a, b) => (b.score || 0) - (a.score || 0));

	// ✨ NEW: Ensure at least 25 keywords if available, but limit to exactly 25
	const targetCount = 25;
	let finalRanked = filteredRanked;

	// If we have fewer than 25, try to get more by requesting additional keywords
	if (finalRanked.length < targetCount && ideas && ideas.length > 0) {
		console.log(
			`   🔄 [SECONDARY KEYWORD] Only have ${finalRanked.length} keywords, need ${targetCount}. Attempting to get more...`
		);

		// Try to get more keywords by using variations of the primary keyword
		try {
			const variations = [
				`${primary} guide`,
				`${primary} tutorial`,
				`${primary} tips`,
				`${primary} examples`,
				`${primary} best practices`,
			];

			const additionalBatches = await Promise.all(
				variations.slice(0, 3).map(async (variation) => {
					try {
						const additionalIdeas =
							await keywordTool.getKeywordIdeas(
								variation,
								location
							);
						return additionalIdeas || [];
					} catch (err) {
						console.warn(
							`   ⚠️  Failed to get keywords for variation "${variation}"`
						);
						return [];
					}
				})
			);

			const additionalMerged = keywordTool.dedupeMerge(
				additionalBatches.flat()
			);
			const additionalRanked = keywordTool.scoreIdeas(
				additionalMerged,
				primary,
				true // Prioritize relevance
			) as any[];

			// Combine with existing, filter out primary keyword, and sort
			const combined = [...filteredRanked, ...additionalRanked]
				.filter(
					(k) =>
						k.text.toLowerCase() !==
						primary.toLowerCase()
				)
				.sort((a, b) => (b.score || 0) - (a.score || 0));

			// Remove duplicates based on text
			const uniqueMap = new Map<string, any>();
			combined.forEach((k) => {
				const key = k.text.toLowerCase();
				if (
					!uniqueMap.has(key) ||
					(uniqueMap.get(key)?.score || 0) < (k.score || 0)
				) {
					uniqueMap.set(key, k);
				}
			});

			finalRanked = Array.from(uniqueMap.values()).sort(
				(a, b) => (b.score || 0) - (a.score || 0)
			);

			console.log(
				`   ✅ [SECONDARY KEYWORD] After fetching additional keywords: ${finalRanked.length} total`
			);
		} catch (err) {
			console.warn(
				`   ⚠️  [SECONDARY KEYWORD] Failed to get additional keywords:`,
				err
			);
		}
	}

	// Limit to exactly 25 keywords (or available count if less than 25)
	const limitedRanked = finalRanked.slice(0, targetCount);

	console.log(
		`📊 [SECONDARY KEYWORD RESEARCH] Final count: ${limitedRanked.length} keywords (target: ${targetCount})`
	);

	// ✨ NEW: Handle no keywords found gracefully
	if (limitedRanked.length === 0) {
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
		limitedRanked.length > 0
	) {
		return {
			data: {
				...state.data,
				secondaryKeywords: limitedRanked
					.slice(0, 5)
					.map((k) => k.text),
			},
			currentStep: 'secondary_keywords',
			trace: [
				{
					step: 'KeywordResearch.secondaryCandidates',
					info: { count: limitedRanked.length },
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

	// ✨ Case 3: Show options to user (always show at least 25 if available)
	return {
		halt: { reason: 'await_secondary_selection' },
		keywordCandidates: limitedRanked, // ✨ Limited to 25, filtered by primary keyword intent
		currentStep: 'secondary_keywords',
		toolOutputs: [
			{
				type: 'keyword_options',
				data: { type: 'secondary', candidates: limitedRanked },
				timestamp: Date.now(),
			},
		],
		trace: [
			{
				step: 'KeywordResearch.secondaryCandidates',
				info: { count: limitedRanked.length },
				at: Date.now(),
			},
		],
	};
};
