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

		// Get apiKey from environment variable first (preferred), then state
		// This allows the API key to be configured server-side via .env
		const apiKey = process.env.GEMINI_API_KEY || state.apiKey;
		if (!apiKey) {
			throw new Error('API Key is required for web search. Please set GEMINI_API_KEY in your .env file.');
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

		// ✨ FLOW: Step 2 - Pass URLs to Google Ads Keyword Planner API
		console.log(
			'🔍 [PRIMARY KEYWORD RESEARCH] Step 2: Getting keywords from URLs via Google Ads Keyword Planner API...'
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
		// Common stop words to exclude from topic word matching
		const stopWords = new Set([
			'and',
			'the',
			'for',
			'are',
			'but',
			'not',
			'you',
			'all',
			'can',
			'her',
			'was',
			'one',
			'our',
			'out',
			'day',
			'get',
			'has',
			'him',
			'his',
			'how',
			'its',
			'may',
			'new',
			'now',
			'old',
			'see',
			'two',
			'way',
			'who',
			'boy',
			'did',
			'its',
			'let',
			'put',
			'say',
			'she',
			'too',
			'use',
			'that',
			'this',
			'with',
			'have',
			'from',
			'they',
			'been',
			'than',
			'their',
			'would',
			'there',
			'about',
			'which',
			'these',
			'other',
			'more',
			'very',
			'what',
			'know',
			'just',
			'first',
			'also',
			'after',
			'back',
			'well',
			'many',
			'only',
			'over',
			'such',
			'take',
			'than',
			'them',
			'then',
			'when',
			'will',
			'your',
			'into',
			'time',
			'come',
			'here',
			'make',
			'like',
			'long',
			'look',
			'more',
			'most',
			'much',
			'name',
			'never',
			'next',
			'once',
			'open',
			'own',
			'part',
			'play',
			'right',
			'same',
			'seem',
			'show',
			'side',
			'some',
			'take',
			'tell',
			'than',
			'that',
			'them',
			'then',
			'there',
			'these',
			'they',
			'thing',
			'think',
			'this',
			'those',
			'three',
			'through',
			'time',
			'today',
			'together',
			'too',
			'turn',
			'two',
			'under',
			'until',
			'upon',
			'very',
			'want',
			'way',
			'well',
			'were',
			'what',
			'when',
			'where',
			'which',
			'while',
			'white',
			'who',
			'whole',
			'whose',
			'why',
			'will',
			'with',
			'within',
			'without',
			'work',
			'world',
			'would',
			'write',
			'year',
			'years',
			'yet',
			'you',
			'young',
			'your',
			'yours',
			'yourself',
		]);

		// Common acronyms and their expansions for better keyword matching
		const acronymExpansions: Record<string, string[]> = {
			asi: [
				'artificial',
				'superintelligence',
				'super',
				'intelligence',
			],
			ai: ['artificial', 'intelligence'],
			agi: ['artificial', 'general', 'intelligence'],
			ml: ['machine', 'learning'],
			dl: ['deep', 'learning'],
			nlp: ['natural', 'language', 'processing'],
			cv: ['computer', 'vision'],
			api: ['application', 'programming', 'interface'],
			ui: ['user', 'interface'],
			ux: ['user', 'experience'],
			seo: ['search', 'engine', 'optimization'],
			crm: ['customer', 'relationship', 'management'],
			erp: ['enterprise', 'resource', 'planning'],
			saas: ['software', 'service'],
			paas: ['platform', 'service'],
			iaas: ['infrastructure', 'service'],
		};

		// Expand acronyms in topic for better matching
		const expandAcronyms = (
			text: string
		): { expanded: string; expansions: string[] } => {
			const lowerText = text.toLowerCase();
			const words = lowerText.split(/\W+/);

			// Check each word if it's an acronym and expand it
			const expandedWords: string[] = [];
			const foundExpansions: string[] = [];

			words.forEach((word) => {
				const lowerWord = word.toLowerCase();
				if (acronymExpansions[lowerWord]) {
					// Add both the acronym and its expansion
					expandedWords.push(word); // Keep original
					expandedWords.push(
						...acronymExpansions[lowerWord]
					); // Add expansion
					foundExpansions.push(
						`${word.toUpperCase()} → ${acronymExpansions[
							lowerWord
						].join(' ')}`
					);
				} else {
					expandedWords.push(word);
				}
			});

			return {
				expanded: expandedWords.join(' '),
				expansions: foundExpansions,
			};
		};

		// Expand topic to include acronym expansions
		const {
			expanded: expandedTopic,
			expansions: acronymExpansionsFound,
		} = expandAcronyms(topicSource || '');

		if (acronymExpansionsFound.length > 0) {
			console.log(`   🔤 Expanded acronyms in topic:`);
			acronymExpansionsFound.forEach((exp) => {
				console.log(`      ${exp}`);
			});
		}

		// Extract meaningful topic words (exclude stop words and short words)
		// Include both original and expanded forms
		const topicWords = new Set(
			expandedTopic
				.split(/\W+/)
				.filter((w) => w.length >= 3) // Only meaningful words (3+ chars)
				.filter((w) => !stopWords.has(w)) // Exclude stop words
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
			'sign up',
			'signing up',
			'sign up for',
			'sign up to',
			'sign up with',
			'sign up at',
			'sign up on',
			'sign up by',
			'sign up as',
			'got you',
			'nothing anything',
			'you say it',
		];

		// Calculate relevance score for each keyword (similarity to topic)
		// Also returns the count of topic words found in the keyword
		// Stop words are excluded from matching
		const calculateRelevanceScore = (
			kwText: string
		): {
			score: number;
			topicWordMatches: number;
			matchedTopicWords: string[];
		} => {
			const kwWords = new Set(
				kwText
					.toLowerCase()
					.split(/\W+/)
					.filter(Boolean)
					.filter((w) => w.length >= 3)
					.filter((w) => !stopWords.has(w)) // Exclude stop words
			);

			if (topicWords.size === 0 || kwWords.size === 0) {
				return {
					score: 0,
					topicWordMatches: 0,
					matchedTopicWords: [],
				};
			}

			// Track which topic words are matched
			const matchedTopicWords: string[] = [];

			// Count exact word matches
			let exactMatches = 0;
			kwWords.forEach((word) => {
				if (topicWords.has(word)) {
					exactMatches++;
					if (!matchedTopicWords.includes(word)) {
						matchedTopicWords.push(word);
					}
				}
			});

			// Count partial matches (substring matches for better intent capture)
			let partialMatches = 0;
			kwWords.forEach((kwWord) => {
				topicWords.forEach((topicWord) => {
					if (
						kwWord.includes(topicWord) ||
						topicWord.includes(kwWord)
					) {
						partialMatches++;
						if (
							!matchedTopicWords.includes(topicWord)
						) {
							matchedTopicWords.push(topicWord);
						}
					}
				});
			});

			// Combine exact and partial matches with weights
			const exactScore =
				exactMatches /
				Math.max(1, Math.min(topicWords.size, kwWords.size));
			const partialScore = Math.min(
				1,
				partialMatches / (topicWords.size + kwWords.size)
			);

			// Return combined similarity (prioritize exact matches)
			const score = Math.min(
				1,
				0.7 * exactScore + 0.3 * partialScore
			);

			return {
				score,
				topicWordMatches: matchedTopicWords.length,
				matchedTopicWords,
			};
		};

		// Filter function to check if keyword should be included
		// MUST contain at least one word from the user's topic
		const shouldIncludeKeyword = (kw: any): boolean => {
			const kwText = kw.text.toLowerCase();

			// Filter out generic phrases
			if (
				genericPhrases.some((phrase) => kwText.includes(phrase))
			) {
				return false;
			}

			// ✨ STRICT REQUIREMENT: Keyword MUST contain at least one MEANINGFUL word from user's topic
			// Stop words are NOT considered valid matches
			if (topicWords.size > 0) {
				const kwWords = kwText
					.split(/\W+/)
					.filter((w: string) => w.length >= 3)
					.filter((w: string) => !stopWords.has(w)); // Exclude stop words from keyword words too

				// If keyword only contains stop words, reject it immediately
				if (kwWords.length === 0) {
					return false;
				}

				// Check for exact matches first (most important) - only meaningful words
				const exactMatches = kwWords.filter((kwWord: string) =>
					topicWords.has(kwWord)
				);

				// Check for partial matches (substring matches) - only meaningful words
				const partialMatches: string[] = [];
				kwWords.forEach((kwWord: string) => {
					for (const topicWord of topicWords) {
						if (
							(kwWord.includes(topicWord) ||
								topicWord.includes(kwWord)) &&
							!exactMatches.includes(kwWord) &&
							!partialMatches.includes(topicWord)
						) {
							partialMatches.push(topicWord);
						}
					}
				});

				// ✨ STRICT: Require at least one MEANINGFUL topic word match (exact or partial)
				// Stop words don't count as valid matches
				const hasTopicWord =
					exactMatches.length > 0 ||
					partialMatches.length > 0;

				if (!hasTopicWord) {
					return false;
				}

				// Store the matched topic words for later use in scoring
				kw._matchedTopicWords = [
					...exactMatches,
					...partialMatches,
				];
			} else {
				// If no meaningful topic words (only stop words), reject the keyword
				return false;
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

		// Add relevance score to each keyword and filter
		// First filter to ensure keywords contain topic words
		const preFilteredKeywords =
			scoredKeywords.filter(shouldIncludeKeyword);

		// Then calculate relevance scores for filtered keywords
		const keywordsWithRelevance = preFilteredKeywords.map((kw) => {
			const relevanceData = calculateRelevanceScore(kw.text);
			return {
				...kw,
				relevanceScore: relevanceData.score,
				topicWordMatches: relevanceData.topicWordMatches,
				matchedTopicWords: relevanceData.matchedTopicWords,
			};
		});

		// ✨ ENHANCED FILTERING: Prioritize keywords with more topic word matches
		// Sort by: 1) Number of topic word matches, 2) Relevance score, 3) Overall score
		keywordsWithRelevance.sort((a, b) => {
			// First priority: More topic word matches = better
			if (b.topicWordMatches !== a.topicWordMatches) {
				return b.topicWordMatches - a.topicWordMatches;
			}
			// Second priority: Higher relevance score
			if (b.relevanceScore !== a.relevanceScore) {
				return b.relevanceScore - a.relevanceScore;
			}
			// Third priority: Higher overall score
			return b.score - a.score;
		});

		// Group keywords by relevance score tiers (100%, 90%, 80%, etc.)
		const groupByRelevanceTier = (
			keywords: Array<(typeof keywordsWithRelevance)[0]>
		) => {
			const tiers: Array<{
				minScore: number;
				maxScore: number;
				label: string;
				keywords: typeof keywords;
			}> = [
				{
					minScore: 0.95,
					maxScore: 1.0,
					label: '100%',
					keywords: [],
				},
				{
					minScore: 0.85,
					maxScore: 0.95,
					label: '90%',
					keywords: [],
				},
				{
					minScore: 0.75,
					maxScore: 0.85,
					label: '80%',
					keywords: [],
				},
				{
					minScore: 0.65,
					maxScore: 0.75,
					label: '70%',
					keywords: [],
				},
				{
					minScore: 0.55,
					maxScore: 0.65,
					label: '60%',
					keywords: [],
				},
				{
					minScore: 0.45,
					maxScore: 0.55,
					label: '50%',
					keywords: [],
				},
				{
					minScore: 0.35,
					maxScore: 0.45,
					label: '40%',
					keywords: [],
				},
				{
					minScore: 0.25,
					maxScore: 0.35,
					label: '30%',
					keywords: [],
				},
				{
					minScore: 0.15,
					maxScore: 0.25,
					label: '20%',
					keywords: [],
				},
				{
					minScore: 0.0,
					maxScore: 0.15,
					label: '10%',
					keywords: [],
				},
			];

			keywords.forEach((kw) => {
				for (const tier of tiers) {
					// For the highest tier (100%), use >= minScore
					// For other tiers, use >= minScore && < maxScore to avoid overlap
					const isHighestTier = tier.minScore === 0.95;
					if (
						isHighestTier
							? kw.relevanceScore >= tier.minScore
							: kw.relevanceScore >=
									tier.minScore &&
							  kw.relevanceScore < tier.maxScore
					) {
						tier.keywords.push(kw);
						break;
					}
				}
			});

			// Sort keywords within each tier by: 1) topic word matches, 2) overall score
			tiers.forEach((tier) => {
				tier.keywords.sort((a, b) => {
					// First priority: More topic word matches
					const aMatches = a.topicWordMatches || 0;
					const bMatches = b.topicWordMatches || 0;
					if (bMatches !== aMatches) {
						return bMatches - aMatches;
					}
					// Second priority: Higher overall score
					return b.score - a.score;
				});
			});

			return tiers;
		};

		const relevanceTiers = groupByRelevanceTier(keywordsWithRelevance);

		// Log tier distribution
		console.log('   📊 Keywords grouped by relevance to topic:');
		relevanceTiers.forEach((tier) => {
			if (tier.keywords.length > 0) {
				const avgTopicMatches =
					tier.keywords.reduce(
						(sum, kw) =>
							sum + (kw.topicWordMatches || 0),
						0
					) / tier.keywords.length;
				console.log(
					`      ${tier.label} match (${(
						tier.minScore * 100
					).toFixed(0)}-${(tier.maxScore * 100).toFixed(
						0
					)}%): ${
						tier.keywords.length
					} keywords (avg ${avgTopicMatches.toFixed(
						1
					)} topic word matches)`
				);
			}
		});

		// Combine keywords in order: 100% first, then 90%, then 80%, etc.
		ranked = [];
		for (const tier of relevanceTiers) {
			if (ranked.length >= 25) break;
			const remaining = 25 - ranked.length;
			ranked.push(...tier.keywords.slice(0, remaining));
		}

		// If we still need more keywords, fill from remaining tiers
		if (ranked.length < 25) {
			for (const tier of relevanceTiers) {
				if (ranked.length >= 25) break;
				const alreadyAdded = ranked.filter((kw) =>
					tier.keywords.some((tkw) => tkw.text === kw.text)
				).length;
				const remaining = 25 - ranked.length;
				ranked.push(
					...tier.keywords.slice(
						alreadyAdded,
						alreadyAdded + remaining
					)
				);
			}
		}

		console.log(
			`   ✅ Filtered and ranked ${ranked.length} keywords by relevance tiers (100% → 90% → 80% → ...)`
		);

		// ✨ FALLBACK: If we have less than 10 keywords, search for more URLs and fetch additional keywords
		if (ranked.length < 10) {
			console.log(
				`   ⚠️  Only found ${ranked.length} keywords (less than 10). Searching for additional URLs...`
			);

			try {
				// Store existing URLs to avoid duplicates
				const existingUrls = new Set(
					webUrls.map((url) => url.toLowerCase())
				);

				// Search for new URLs with a slightly modified query to get different results
				const fallbackSearchQuery = `${topicSource} guide tutorial examples`;
				console.log(
					`   🔍 [FALLBACK SEARCH] Searching for additional URLs with query: "${fallbackSearchQuery}"`
				);

				const additionalWebUrls =
					await geminiService.searchWebForUrls(
						fallbackSearchQuery,
						apiKey
					);

				// Filter out URLs we've already used
				const newUrls = additionalWebUrls.filter(
					(url) => !existingUrls.has(url.toLowerCase())
				);

				console.log(
					`   ✅ Found ${newUrls.length} new URLs (${
						additionalWebUrls.length - newUrls.length
					} duplicates filtered)`
				);

				if (newUrls.length > 0) {
					console.log(`   📋 New URLs:`);
					newUrls.forEach((url, idx) => {
						console.log(`      ${idx + 1}. ${url}`);
					});

					// Fetch keywords from new URLs
					console.log(
						'   🔍 [FALLBACK] Getting keywords from new URLs...'
					);
					const additionalKeywords =
						await keywordTool.getKeywordsFromUrls(
							newUrls,
							location,
							topicSource
						);

					console.log(
						`   ✅ Got ${additionalKeywords.length} additional keywords from ${newUrls.length} new URLs`
					);

					if (additionalKeywords.length > 0) {
						// Merge with existing keywords (avoid duplicates)
						const existingKeywordTexts = new Set(
							keywordsFromUrls.map((kw) =>
								kw.text.toLowerCase()
							)
						);
						const uniqueAdditionalKeywords =
							additionalKeywords.filter(
								(kw) =>
									!existingKeywordTexts.has(
										kw.text.toLowerCase()
									)
							);

						console.log(
							`   🔄 Merging ${uniqueAdditionalKeywords.length} unique additional keywords with existing ${keywordsFromUrls.length} keywords`
						);

						// Combine all keywords
						const allKeywords = [
							...keywordsFromUrls,
							...uniqueAdditionalKeywords,
						];

						// Re-score all keywords
						let rescoredKeywords =
							keywordTool.scoreIdeas(
								allKeywords,
								topicSource,
								true // Prioritize relevance/intent over volume
							);

						// Re-apply filtering with relevance scoring
						const rescoredWithRelevance =
							rescoredKeywords
								.map((kw) => {
									const relevanceData =
										calculateRelevanceScore(
											kw.text
										);
									return {
										...kw,
										relevanceScore:
											relevanceData.score,
										topicWordMatches:
											relevanceData.topicWordMatches,
										matchedTopicWords:
											relevanceData.matchedTopicWords,
									};
								})
								.filter(shouldIncludeKeyword);

						// Re-sort by topic word matches, relevance, and score
						rescoredWithRelevance.sort((a, b) => {
							if (
								b.topicWordMatches !==
								a.topicWordMatches
							) {
								return (
									b.topicWordMatches -
									a.topicWordMatches
								);
							}
							if (
								b.relevanceScore !==
								a.relevanceScore
							) {
								return (
									b.relevanceScore -
									a.relevanceScore
								);
							}
							return b.score - a.score;
						});

						// Re-group by relevance tiers
						const newRelevanceTiers =
							groupByRelevanceTier(
								rescoredWithRelevance
							);

						// Re-create ranked list
						ranked = [];
						for (const tier of newRelevanceTiers) {
							if (ranked.length >= 25) break;
							const remaining = 25 - ranked.length;
							ranked.push(
								...tier.keywords.slice(
									0,
									remaining
								)
							);
						}

						// Fill remaining slots if needed
						if (ranked.length < 25) {
							for (const tier of newRelevanceTiers) {
								if (ranked.length >= 25) break;
								const alreadyAdded =
									ranked.filter((kw) =>
										tier.keywords.some(
											(tkw) =>
												tkw.text ===
												kw.text
										)
									).length;
								const remaining =
									25 - ranked.length;
								ranked.push(
									...tier.keywords.slice(
										alreadyAdded,
										alreadyAdded +
											remaining
									)
								);
							}
						}

						console.log(
							`   ✅ [FALLBACK] After additional search: ${ranked.length} keywords total (added ${uniqueAdditionalKeywords.length} new keywords)`
						);
					} else {
						console.log(
							`   ⚠️  [FALLBACK] No additional keywords found from new URLs`
						);
					}
				} else {
					console.log(
						`   ⚠️  [FALLBACK] No new URLs found (all were duplicates)`
					);
				}
			} catch (err) {
				console.error(
					'   ⚠️  [FALLBACK] Failed to fetch additional keywords:',
					err
				);
				// Continue with existing ranked list even if fallback fails
			}
		}

		const filteredOutCount =
			scoredKeywords.length - keywordsWithRelevance.length;
		if (filteredOutCount > 0) {
			console.log(
				`   🧹 Filtered out ${filteredOutCount} irrelevant keywords`
			);
		}
		console.log(
			`   🎯 Top ${ranked.length} keywords filtered by relevance tiers (100% → 90% → 80% → ...):`
		);
		ranked.forEach((kw: any, idx: number) => {
			const relevancePercent = (
				(kw.relevanceScore || 0) * 100
			).toFixed(0);
			const topicMatches = kw.topicWordMatches || 0;
			const matchedWords =
				kw.matchedTopicWords && kw.matchedTopicWords.length > 0
					? ` [${kw.matchedTopicWords.join(', ')}]`
					: '';
			console.log(
				`      ${idx + 1}. "${
					kw.text
				}" (Relevance: ${relevancePercent}%, Topic Words: ${topicMatches}${matchedWords}, Overall Score: ${kw.score.toFixed(
					3
				)}, Volume: ${kw.volume}, Difficulty: ${kw.difficulty})`
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
