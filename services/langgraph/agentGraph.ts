import {
	BlogData,
	Interlink,
	OutlineSection,
	AgentPreferences,
	ConversationContext,
} from '../../types';
import { AgentState, ReferencesUsage } from '../../server/agent/state';
import * as geminiService from '../geminiService';
import * as agentService from '../agentService';
import * as automationEngine from '../automationEngine';

const appendTrace = (
	s: AgentState,
	step: string,
	info?: Record<string, any>
) => {
	s.trace.push({ step, info, at: Date.now() });
};

export async function discoveryNode(s: AgentState): Promise<AgentState> {
	const shouldUseRefs =
		s.policy.referencesUsage === 'both' ||
		s.policy.referencesUsage === 'outline-only';

	// 📚 Log reference materials being used for outline
	if (shouldUseRefs) {
		console.log('📚 [OUTLINE GENERATION] Using references:');
		console.log(`   URLs: ${s.data.referenceUrls?.length || 0}`);
		console.log(`   Files: ${s.data.referenceFiles?.length || 0}`);
	}

	const input: BlogData = {
		...s.data,
		outline: [],
		referenceUrls: shouldUseRefs ? s.data.referenceUrls : [],
		referenceFiles: shouldUseRefs ? s.data.referenceFiles : [],
	} as BlogData;

	// ✨ Check if user provided feedback for outline regeneration
	let outline: OutlineSection[];

	if (s.outlineFeedback && s.outline && s.outline.length > 0) {
		console.log(
			'🔄 [OUTLINE REGENERATION] User feedback received, regenerating outline...'
		);
		console.log(`   Feedback: ${s.outlineFeedback}`);

		// Regenerate outline with user feedback - pass current outline in input
		const inputWithOutline: BlogData = {
			...input,
			outline: s.outline,
		};

		outline = await geminiService.generateOutline(
			inputWithOutline,
			s.apiKey,
			s.outlineFeedback
		);

		appendTrace(s, 'DiscoveryNode.regeneratedOutline', {
			h2Count: outline.length,
			hadFeedback: true,
		});

		console.log(
			`✅ [OUTLINE REGENERATION] Complete! New outline has ${outline.length} sections`
		);

		// Clear the feedback after using it
		s.outlineFeedback = undefined;
	} else {
		// Generate outline for the first time
		console.log('📝 [OUTLINE GENERATION] Creating initial outline...');
		outline = await geminiService.generateOutline(input, s.apiKey);

		appendTrace(s, 'DiscoveryNode.generatedOutline', {
			h2Count: outline.length,
		});

		console.log(
			`✅ [OUTLINE GENERATION] Complete! Outline has ${outline.length} sections`
		);
	}

	s.outline = outline;

	// ✨ Clear draft - it will be populated during blog generation with title + content
	s.draft = '';

	// ✨ ALWAYS require outline approval from user (removed auto-approval)
	s.halt = { reason: 'awaiting_approval' };
	return s;
}

export async function estimatorNode(s: AgentState): Promise<AgentState> {
	// ✨ Estimator node is now a no-op since SEO ranking has been removed
	return s;
}

export async function proposalNode(s: AgentState): Promise<AgentState> {
	if (!s.outlineApproved) return s;
	const idx = s.progress.sectionIndex ?? 0;
	console.log(`✍️ [PROPOSAL] sectionIndex=${idx}, outlineLength=${s.outline?.length || 0}`);
	if (idx >= s.outline.length) return s;

	// ✨ Clear the approval halt once we start generating content
	if (idx === 0 && s.halt?.reason === 'awaiting_approval') {
		s.halt = undefined;
	}

	// ✨ Initialize draft with title on first section
	if (idx === 0 && (!s.draft || s.draft.trim() === '')) {
		s.draft = `# ${s.data.title || 'Untitled'}\n\n`;
	}

	const section = s.outline[idx];
	const useRefs =
		s.policy.referencesUsage === 'both' ||
		s.policy.referencesUsage === 'content-only';

	// 📚 Log reference usage for this section
	if (useRefs && idx === 0) {
		console.log('📚 [CONTENT GENERATION] Using references:');
		console.log(`   URLs: ${s.data.referenceUrls?.length || 0}`);
		console.log(`   Files: ${s.data.referenceFiles?.length || 0}`);
	}

	// ✨ Fetch user language and model with fallback
	const { getUserLanguage, getUserModel } = await import(
		'../../../server/db/userService'
	);
	const userLanguage = await getUserLanguage(s.userId);
	const userModel = await getUserModel(s.userId);

	const sectionMd = await agentService.generateSectionContent(
		s.data,
		section,
		s.apiKey,
		{
			targetKeyword: s.data.primaryKeyword,
			interlinks: s.data.interlinks as Interlink[],
			referenceUrls: useRefs ? s.data.referenceUrls : [],
			language: userLanguage, // ✨ Pass language parameter
			model: userModel, // ✨ Pass model parameter
		}
	);
	if (useRefs && (s.data.referenceUrls?.length || 0) > 0) {
		const used =
			s.data.referenceUrls.some((u) => sectionMd.includes(u)) ||
			/\[[0-9]+\]/.test(sectionMd) ||
			/https?:\/\//.test(sectionMd);
		if (!used) {
			s.halt = { reason: 'references_not_used' };
			appendTrace(s, 'ProposalNode.pausedNoRefs', {
				section: section.name,
			});
			return s;
		}
	}
	s.draft = `${s.draft}\n\n${sectionMd}`;
	s.progress.sectionIndex = idx + 1;
	appendTrace(s, 'ProposalNode.generatedSection', {
		sectionIndex: idx,
		section: section.name,
	});
	return s;
}

export function route(
	s: AgentState
):
	| 'research_primary'
	| 'research_secondary'
	| 'title_generation'
	| 'interlinking'
	| 'references'
	| 'discover'
	| 'await_approval'
	| 'proposal'
	| 'final_blog'
	| 'done' {
	// If any node set a halt reason, stop the graph run and wait for user input.
	// Without this, the router can keep re-entering the same node and hit recursion limits.
	if (s.halt?.reason && s.halt.reason !== 'awaiting_approval') {
		console.log(`   → Route: done (halted: ${s.halt.reason})`);
		return 'done';
	}

	// ✨ PRIORITY: If user provided outline feedback, regenerate outline
	if (s.outlineFeedback?.trim()) {
		console.log(
			'🔄 [ROUTE] Outline feedback detected, routing to discoveryNode for regeneration'
		);
		return 'discover';
	}

	// Step 1: Primary keyword selected?
	if (!s.data.primaryKeyword?.trim()) return 'research_primary';

	// Step 2: Secondary keywords present? (optional but recommended)
	if (!s.data.secondaryKeywords || s.data.secondaryKeywords.length === 0)
		return 'research_secondary';

	// Step 3: Title generation (after keywords selected)
	if (!s.titleSelected && !s.data.title?.trim()) return 'title_generation';

	// Step 4: Interlinking (optional)
	if (!s.interlinkingCompleted) return 'interlinking';

	// Step 5: References collection (optional)
	if (!s.referencesCollected) return 'references';

	// Step 6: Outline generation
	if (!s.outline || s.outline.length === 0) return 'discover';

	// Step 7: Outline approval (only if outline exists and not yet approved)
	// Check halt reason to ensure we only ask for approval when explicitly waiting for it
	if (!s.outlineApproved && s.halt?.reason === 'awaiting_approval')
		return 'await_approval';

	// Step 8: Section-by-section generation (draft mode)
	if (
		(s.progress.sectionIndex ?? 0) < s.outline.length &&
		!s.finalBlogGenerated
	)
		return 'proposal';

	// Step 9: Final blog generation (if all sections done but final blog not generated)
	if (
		!s.finalBlogGenerated &&
		(s.progress.sectionIndex ?? 0) >= s.outline.length
	)
		return 'final_blog';

	return 'done';
}

import * as keywordTool from '../keywordService';

export async function researchPrimaryNode(s: AgentState): Promise<AgentState> {
	// ✨ Case 1: User already provided keyword
	if (automationEngine.isUserProvided(s, 'primaryKeyword')) {
		appendTrace(s, 'KeywordResearch.userProvided', {
			keyword: s.data.primaryKeyword,
		});
		return s; // Skip research, use user's keyword
	}

	// 🎯 Extract main topic from multiple sources
	const topicSource =
		s.data.title || s.data.topic || s.data.primaryKeyword || '';

	// 📊 LOG: Show what we're extracting from
	console.log('🔍 [PRIMARY KEYWORD RESEARCH] Starting...');
	console.log(`   Topic source: "${topicSource}"`);

	// 🎯 Extract intelligent seeds using enhanced extraction
	const extractedSeeds = keywordTool.extractSeedsFromTitle(topicSource, 5);

	// Combine with any user-provided primary keyword
	const seeds = [
		...(s.data.primaryKeyword ? [s.data.primaryKeyword] : []),
		...extractedSeeds,
	];

	const location = s.data.targetLocation || 'United States';

	console.log(`   📍 Location: ${location}`);
	console.log(`   🎯 Will fetch keywords for ${seeds.length} seed(s)`);

	let ranked: any[] = [];

	try {
		const batches = await Promise.all(
			seeds.map(async (k, idx) => {
				console.log(
					`   📡 Fetching keywords for seed ${idx + 1}/${
						seeds.length
					}: "${k}"`
				);
				try {
					const results = await keywordTool.getKeywordIdeas(
						k,
						location
					);
					console.log(
						`   ✅ Got ${results.length} keywords for "${k}"`
					);
					return results;
				} catch (err) {
					console.error(
						`   ❌ Failed to fetch keywords for "${k}":`,
						err
					);
					return [];
				}
			})
		);

		const merged = keywordTool.dedupeMerge(batches.flat());
		let scoredKeywords = keywordTool.scoreIdeas(
			merged,
			s.data.title || s.data.topic || '',
			true // Prioritize relevance/intent over volume
		);

		// ✨ NEW: Check for regeneration feedback
		const feedback = s.conversationContext?.primaryKeywordFeedback;
		if (feedback) {
			console.log(
				`   🔄 [KEYWORD REGENERATION] Generating NEW keywords based on feedback: "${feedback}"`
			);
			try {
				const { filterKeywordsWithFeedback } = await import(
					'../geminiService'
				);
				// Generate completely new keywords based on feedback
				const newKeywords = await filterKeywordsWithFeedback(
					scoredKeywords.slice(0, 50), // Pass some context for reference
					s.data.title || s.data.topic || '',
					feedback,
					s.apiKey
				);
				if (newKeywords && newKeywords.length > 0) {
					// Re-score new keywords with feedback in mind
					scoredKeywords = keywordTool.scoreIdeas(
						newKeywords,
						`${
							s.data.title || s.data.topic || ''
						} ${feedback}`,
						true
					);
					console.log(
						`   ✅ [KEYWORD REGENERATION] Generated ${scoredKeywords.length} NEW keywords based on feedback`
					);
					// Clear feedback after using it
					if (s.conversationContext) {
						s.conversationContext.primaryKeywordFeedback =
							undefined;
					}
				}
			} catch (err) {
				console.error(
					'   ⚠️  [KEYWORD REGENERATION] Failed to generate new keywords with feedback:',
					err
				);
			}
		}

		// Filter keywords with 30%+ matching score, ensuring at least 25 keywords
		const topicSource = s.data.title || s.data.topic || '';
		const topicWords = new Set(
			(topicSource || '')
				.toLowerCase()
				.split(/\W+/)
				.filter((w) => w.length >= 3)
		);

		// Filter function with configurable threshold
		const isRelevantKeyword = (
			kw: any,
			scoreThreshold: number = 0.3
		): boolean => {
			const kwText = kw.text.toLowerCase();

			// Filter out keywords with score below threshold
			if (kw.score < scoreThreshold) {
				return false;
			}

			// Filter out keywords that don't contain any topic words
			if (topicWords.size > 0) {
				const kwWords = kwText
					.split(/\W+/)
					.filter((w: string) => w.length >= 3);
				const hasTopicWord = kwWords.some((kwWord: string) => {
					if (topicWords.has(kwWord)) return true;
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

			return true;
		};

		// Apply filtering with 30% threshold (preferred)
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
			`✅ [PRIMARY KEYWORD RESEARCH] Complete! Found ${ranked.length} top keywords (filtered from ${scoredKeywords.length} total)`
		);

		s.keywordResearch = s.keywordResearch || {};
		s.keywordResearch.primaryCandidates = ranked;
		s.keywordResearch.snapshot = { seeds, location };
	} catch (err) {
		console.error('❌ [PRIMARY KEYWORD RESEARCH] Fatal error:', err);
		// Set empty results on failure
		s.keywordResearch = s.keywordResearch || {};
		s.keywordResearch.primaryCandidates = [];
		s.keywordResearch.snapshot = { seeds, location };
	}

	// ✨ Case 2: Auto-select if automation enabled
	if (
		automationEngine.shouldAutoFill(s, 'primaryKeyword') &&
		ranked.length > 0
	) {
		s.data.primaryKeyword = ranked[0].text;
		appendTrace(s, 'KeywordResearch.autoSelected', {
			keyword: ranked[0].text,
			score: ranked[0].score,
		});
		return s; // Don't halt
	}

	// ✨ Case 3: Show options to user (default behavior)
	s.halt = { reason: 'await_keyword_selection' };
	appendTrace(s, 'KeywordResearch.primaryCandidates', {
		count: ranked.length,
	});
	return s;
}

export async function researchSecondaryNode(
	s: AgentState
): Promise<AgentState> {
	const primary = (s.data.primaryKeyword || '').trim();
	if (!primary) return s; // guard

	// ✨ Case 1: User already provided secondary keywords
	if (
		automationEngine.isUserProvided(s, 'secondaryKeywords') &&
		s.data.secondaryKeywords &&
		s.data.secondaryKeywords.length > 0
	) {
		appendTrace(s, 'KeywordResearch.secondaryUserProvided', {
			count: s.data.secondaryKeywords.length,
		});
		return s;
	}

	const location = s.data.targetLocation || 'United States';

	// 📊 LOG: Secondary keyword research starting
	console.log('🔍 [SECONDARY KEYWORD RESEARCH] Starting...');
	console.log(`   Primary Keyword: "${primary}"`);
	console.log(`   Location: ${location}`);

	let ranked: any[] = [];

	try {
		console.log('   📡 Fetching secondary keywords...');
		const ideas = await keywordTool.getKeywordIdeas(primary, location);
		console.log(`   ✅ Got ${ideas.length} keyword ideas`);

		const merged = keywordTool.dedupeMerge(ideas);
		let scoredKeywords = keywordTool.scoreIdeas(
			merged,
			s.data.title || s.data.topic || ''
		);

		// ✨ NEW: Check for regeneration feedback
		const feedback = s.conversationContext?.secondaryKeywordFeedback;
		if (feedback) {
			console.log(
				`   🔄 [SECONDARY KEYWORD REGENERATION] Generating NEW keywords based on feedback: "${feedback}"`
			);
			try {
				const { filterKeywordsWithFeedback } = await import(
					'../geminiService'
				);
				// Generate completely new keywords based on feedback
				const newKeywords = await filterKeywordsWithFeedback(
					scoredKeywords.slice(0, 30), // Pass some context for reference
					s.data.title || s.data.topic || primary,
					feedback,
					s.apiKey
				);
				if (newKeywords && newKeywords.length > 0) {
					// Re-score new keywords with feedback in mind
					scoredKeywords = keywordTool.scoreIdeas(
						newKeywords,
						`${
							s.data.title ||
							s.data.topic ||
							primary
						} ${feedback}`,
						true
					);
					console.log(
						`   ✅ [SECONDARY KEYWORD REGENERATION] Generated ${scoredKeywords.length} NEW keywords based on feedback`
					);
					// Clear feedback after using it
					if (s.conversationContext) {
						s.conversationContext.secondaryKeywordFeedback =
							undefined;
					}
				}
			} catch (err) {
				console.error(
					'   ⚠️  [SECONDARY KEYWORD REGENERATION] Failed to generate new keywords with feedback:',
					err
				);
			}
		}

		ranked = scoredKeywords;

		console.log(
			`✅ [SECONDARY KEYWORD RESEARCH] Complete! Found ${ranked.length} unique keywords`
		);

		// ✨ CRITICAL FIX: Filter out primary keyword from secondary candidates
		const filteredRanked = ranked.filter(
			(k) => k.text.toLowerCase() !== primary.toLowerCase()
		);

		console.log(
			`🔍 [SECONDARY KEYWORDS] Filtered ${
				ranked.length - filteredRanked.length
			} duplicate(s) of primary keyword "${primary}"`
		);

		s.keywordResearch = s.keywordResearch || {};
		s.keywordResearch.secondaryCandidates = filteredRanked; // ✨ Use filtered list
		ranked = filteredRanked; // Update ranked for consistency
	} catch (err) {
		console.error('❌ [SECONDARY KEYWORD RESEARCH] Failed:', err);
		// Set empty results on failure
		s.keywordResearch = s.keywordResearch || {};
		s.keywordResearch.secondaryCandidates = [];
	}

	// ✨ Case 2: Auto-select if automation enabled
	if (
		automationEngine.shouldAutoFill(s, 'secondaryKeywords') &&
		s.keywordResearch.secondaryCandidates.length > 0
	) {
		s.data.secondaryKeywords = s.keywordResearch.secondaryCandidates
			.slice(0, 5)
			.map((k) => k.text);
		appendTrace(s, 'KeywordResearch.secondaryAutoSelected', {
			count: s.data.secondaryKeywords.length,
		});
		return s; // Don't halt
	}

	// ✨ Case 3: Show options to user (default behavior)
	s.halt = { reason: 'await_secondary_selection' };
	appendTrace(s, 'KeywordResearch.secondaryCandidates', {
		count: s.keywordResearch.secondaryCandidates.length,
	});
	return s;
}

export async function titleGenerationNode(s: AgentState): Promise<AgentState> {
	if (!s.data.primaryKeyword?.trim()) return s;

	// ✨ Case 1: User already provided title
	if (automationEngine.isUserProvided(s, 'title') && s.data.title?.trim()) {
		s.titleSelected = true;
		appendTrace(s, 'TitleGeneration.userProvided', {
			title: s.data.title,
		});
		return s;
	}

	// ✨ NEW: Check for regeneration feedback
	const titleFeedback = s.conversationContext?.titleFeedback;
	const isRegeneration =
		!s.titleSelected && (titleFeedback || s.titleOptions?.length === 0);

	if (isRegeneration) {
		console.log(
			'🔄 [TITLE REGENERATION] Regenerating titles with feedback...'
		);
		console.log(
			`   Feedback: ${titleFeedback || 'none (fresh generation)'}`
		);
	}

	// ✨ NEW: Fetch reference titles from web search for inspiration
	console.log(
		'🔍 [TITLE GENERATION] Fetching reference titles from web search...'
	);
	const topicForSearch =
		s.data.title || s.data.topic || s.data.primaryKeyword || '';
	let referenceTitles: string[] = [];

	if (topicForSearch) {
		try {
			referenceTitles = await geminiService.searchWebForTitles(
				topicForSearch,
				s.apiKey
			);
			console.log(
				`   ✅ Found ${referenceTitles.length} reference titles from web search`
			);
			if (referenceTitles.length > 0) {
				console.log(`   📋 Sample reference titles:`);
				referenceTitles.slice(0, 5).forEach((title, idx) => {
					console.log(`      ${idx + 1}. ${title}`);
				});
			}
		} catch (err) {
			console.warn(
				'   ⚠️  Failed to fetch reference titles, continuing without them:',
				err
			);
		}
	}

	// Generate title options using Gemini (with feedback and reference titles)
	const titles = await geminiService.generateTitles(
		s.data,
		s.apiKey,
		titleFeedback, // Pass feedback for regeneration
		referenceTitles // Pass reference titles for inspiration
	);
	s.titleOptions = titles;

	// Clear feedback after using it
	if (titleFeedback && s.conversationContext) {
		s.conversationContext.titleFeedback = undefined;
	}

	// ✨ Case 2: Auto-select if automation enabled
	if (automationEngine.shouldAutoFill(s, 'title') && titles.length > 0) {
		s.data.title = titles[0];
		s.titleSelected = true;
		appendTrace(s, 'TitleGeneration.autoSelected', {
			title: titles[0],
		});
		return s; // Don't halt
	}

	// ✨ Case 3: Show options to user (default behavior)
	s.halt = { reason: 'await_title_selection' };
	appendTrace(
		s,
		isRegeneration
			? 'TitleGeneration.regenerated'
			: 'TitleGeneration.generated',
		{
			count: titles.length,
			hadFeedback: !!titleFeedback,
		}
	);
	return s;
}

export async function interlinkingNode(s: AgentState): Promise<AgentState> {
	// ✨ Auto-skip if automation enabled or user wants to skip optional steps
	if (
		automationEngine.canSkipStep(s, 'interlinking') ||
		s.preferences?.skipOptionalSteps
	) {
		s.interlinkingCompleted = true;
		appendTrace(s, 'Interlinking.autoSkipped');
		return s; // Don't halt
	}

	// User already provided interlinks
	if (
		automationEngine.isUserProvided(s, 'interlinks') &&
		s.data.interlinks &&
		s.data.interlinks.length > 0
	) {
		s.interlinkingCompleted = true;
		appendTrace(s, 'Interlinking.userProvided', {
			count: s.data.interlinks.length,
		});
		return s;
	}

	// This is an optional step - user can skip or add interlinks
	s.halt = { reason: 'await_interlinking' };
	appendTrace(s, 'Interlinking.prompted');
	return s;
}

export async function referencesCollectionNode(
	s: AgentState
): Promise<AgentState> {
	// ✨ Auto-skip if automation enabled or user wants to skip optional steps
	if (
		automationEngine.canSkipStep(s, 'references') ||
		s.preferences?.skipOptionalSteps
	) {
		s.referencesCollected = true;
		appendTrace(s, 'ReferencesCollection.autoSkipped');
		return s; // Don't halt
	}

	// User already provided references
	if (
		automationEngine.isUserProvided(s, 'referenceUrls') &&
		s.data.referenceUrls &&
		s.data.referenceUrls.length > 0
	) {
		s.referencesCollected = true;
		appendTrace(s, 'ReferencesCollection.userProvided', {
			count: s.data.referenceUrls.length,
		});
		return s;
	}

	// This is an optional step - user can skip or add references
	s.halt = { reason: 'await_references' };
	appendTrace(s, 'ReferencesCollection.prompted');
	return s;
}

export async function finalBlogGenerationNode(
	s: AgentState
): Promise<AgentState> {
	if (!s.outlineApproved || !s.outline || s.outline.length === 0) return s;

	// Generate complete blog post using the approved outline
	const fullBlog = await geminiService.generateBlogPost(
		s.data,
		s.outline,
		s.apiKey
	);
	s.draft = fullBlog;
	s.finalBlogGenerated = true;
	appendTrace(s, 'FinalBlog.generated', {
		wordCount: fullBlog.split(/\s+/).length,
	});
	return s;
}

export async function runNext(
	s: AgentState
): Promise<{ state: AgentState; halted: boolean; step: string }> {
	const r = route(s);

	if (r === 'research_primary') {
		const ns = await researchPrimaryNode(s);
		return { state: ns, halted: true, step: 'research_primary' };
	}

	if (r === 'research_secondary') {
		const ns = await researchSecondaryNode(s);
		return { state: ns, halted: true, step: 'research_secondary' };
	}

	if (r === 'title_generation') {
		const ns = await titleGenerationNode(s);
		return { state: ns, halted: true, step: 'title_generation' };
	}

	if (r === 'interlinking') {
		const ns = await interlinkingNode(s);
		return { state: ns, halted: true, step: 'interlinking' };
	}

	if (r === 'references') {
		const ns = await referencesCollectionNode(s);
		return { state: ns, halted: true, step: 'references' };
	}

	if (r === 'discover') {
		const ns = await discoveryNode(s);
		await estimatorNode(ns);
		return { state: ns, halted: true, step: 'discover' };
	}

	if (r === 'await_approval') {
		appendTrace(s, 'Router.awaitApproval');
		return { state: s, halted: true, step: 'await_approval' };
	}

	if (r === 'proposal') {
		const ns = await proposalNode(s);
		await estimatorNode(ns);
		// ✨ Only halt if user input is actually needed
		if (ns.halt && automationEngine.needsUserInput(ns)) {
			return { state: ns, halted: true, step: 'proposal' };
		}
		const more = route(ns) === 'proposal';
		return { state: ns, halted: !more, step: 'proposal' };
	}

	if (r === 'final_blog') {
		const ns = await finalBlogGenerationNode(s);
		await estimatorNode(ns);
		return { state: ns, halted: true, step: 'final_blog' };
	}

	appendTrace(s, 'Router.done');
	return { state: s, halted: true, step: 'done' };
}
