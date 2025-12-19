import { BlogData } from '../types';

export type KwRow = {
	text: string;
	volume: number; // avg monthly searches
	difficulty: number; // 0..1 (higher = harder)
	source?: 'user' | 'seed';
};

// Common stop words to filter out (not useful for keyword research)
const STOP_WORDS = new Set([
	'the',
	'and',
	'or',
	'but',
	'in',
	'on',
	'at',
	'to',
	'for',
	'of',
	'with',
	'by',
	'from',
	'as',
	'is',
	'was',
	'are',
	'be',
	'have',
	'has',
	'had',
	'do',
	'does',
	'did',
	'will',
	'would',
	'should',
	'could',
	'may',
	'might',
	'must',
	'can',
	'its',
	'it',
	'this',
	'that',
	'these',
	'those',
	'a',
	'an',
	'how',
	'what',
	'when',
	'where',
	'who',
	'which',
	'why',
	'there',
	'here',
]);

// Common acronyms and their expansions for better keyword research
const ACRONYM_EXPANSIONS: Record<string, string[]> = {
	ai: ['artificial intelligence', 'ai'],
	asi: ['artificial superintelligence', 'asi', 'super ai'],
	agi: ['artificial general intelligence', 'agi'],
	ml: ['machine learning', 'ml'],
	nlp: ['natural language processing', 'nlp'],
	iot: ['internet of things', 'iot'],
	ar: ['augmented reality', 'ar'],
	vr: ['virtual reality', 'vr'],
	seo: ['search engine optimization', 'seo'],
	api: ['application programming interface', 'api'],
	saas: ['software as a service', 'saas'],
	b2b: ['business to business', 'b2b'],
	b2c: ['business to consumer', 'b2c'],
};

// Enhanced seed extraction with intent-based keyword generation
export function extractSeedsFromTitle(title: string, max = 5): string[] {
	if (!title || title.trim().length === 0) {
		return [];
	}

	const originalTitle = title;
	const seeds: string[] = [];

	// Step 1: Preserve original case for acronym detection
	const words = originalTitle
		.replace(/[^\w\s]/g, ' ')
		.split(/\s+/)
		.filter(Boolean);

	// Step 2: Identify acronyms (2-5 uppercase letters)
	const acronyms: string[] = [];
	words.forEach((word) => {
		if (/^[A-Z]{2,5}$/.test(word)) {
			acronyms.push(word);
		}
	});

	// Step 3: Expand acronyms if known
	acronyms.forEach((acronym) => {
		const key = acronym.toLowerCase();
		if (ACRONYM_EXPANSIONS[key]) {
			const expansions = ACRONYM_EXPANSIONS[key];
			seeds.push(...expansions);
		} else {
			seeds.push(acronym.toLowerCase());
		}
	});

	// Step 4: Extract meaningful tokens (lowercase, filter stop words)
	const tokens = originalTitle
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter(Boolean)
		.filter((t) => t.length >= 3)
		.filter((t) => !STOP_WORDS.has(t));

	// Step 5: Extract 2-3 word phrases (most valuable for keyword research)
	const phrases: string[] = [];

	// 2-word phrases
	for (let i = 0; i < tokens.length - 1; i++) {
		const phrase = `${tokens[i]} ${tokens[i + 1]}`;
		if (phrase.length >= 6) {
			// Avoid very short phrases
			phrases.push(phrase);
		}
	}

	// 3-word phrases (most natural search queries)
	for (let i = 0; i < tokens.length - 2; i++) {
		const phrase = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
		if (phrase.length >= 10) {
			phrases.push(phrase);
		}
	}

	// Step 6: Add individual important tokens
	seeds.push(...tokens);

	// Step 7: Add phrases (prioritize 3-word, then 2-word)
	seeds.push(...phrases);

	// Step 8: Also include the full original phrase (cleaned)
	const fullPhrase = originalTitle
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	if (fullPhrase.length >= 10 && fullPhrase.length <= 100) {
		seeds.unshift(fullPhrase); // Add at beginning
	}

	// Step 9: Deduplicate and prioritize
	const uniqueSeeds = Array.from(new Set(seeds))
		.filter((s) => s.length >= 2) // At least 2 characters
		.sort((a, b) => {
			// Prioritize: phrases > acronyms > single words
			const aWords = a.split(' ').length;
			const bWords = b.split(' ').length;
			if (aWords !== bWords) return bWords - aWords; // More words = higher priority
			return b.length - a.length; // Longer = higher priority
		});

	const finalSeeds = uniqueSeeds.slice(0, Math.max(1, max));

	return finalSeeds;
}

// Generate intent-based keyword variations for better search results
export function generateIntentVariations(baseKeyword: any): string[] {
	// Guard against non-string inputs (e.g., arrays, objects)
	if (typeof baseKeyword !== 'string') {
		return [];
	}

	if (!baseKeyword || baseKeyword.trim().length === 0) {
		return [];
	}

	const base = baseKeyword.trim().toLowerCase();
	const variations: string[] = [base]; // Always include the original

	// Intent patterns for different search behaviors
	const intentPatterns = [
		// Informational intent
		`what is ${base}`,
		`${base} meaning`,
		`${base} explained`,
		`${base} definition`,
		`${base} overview`,

		// How-to intent
		`how to ${base}`,
		`${base} guide`,
		`${base} tutorial`,
		`${base} tips`,

		// Comparison intent
		`${base} vs`,
		`${base} comparison`,
		`${base} alternatives`,
		`best ${base}`,

		// Problem-solving intent
		`${base} benefits`,
		`${base} challenges`,
		`${base} solutions`,
		`${base} impact`,
		`${base} effects`,

		// Future/Trend intent
		`future of ${base}`,
		`${base} trends`,
		`${base} predictions`,

		// Application intent
		`${base} applications`,
		`${base} use cases`,
		`${base} examples`,
	];

	// Only add variations that make sense (not too long)
	intentPatterns.forEach((pattern) => {
		if (pattern.length <= 60) {
			// Reasonable search query length
			variations.push(pattern);
		}
	});

	return variations;
}

/**
 * Extract relevant keywords from multiple titles
 * This function extracts short, focused keywords (2-3 words max) from titles
 */
export function extractKeywordsFromTitles(
	titles: string[],
	maxKeywords: number = 40
): string[] {
	if (!titles || titles.length === 0) {
		return [];
	}

	const keywordFrequency = new Map<string, number>();

	titles.forEach((title) => {
		if (!title || !title.trim()) return;

		// Extract meaningful tokens (lowercase, filter stop words)
		const tokens = title
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, ' ')
			.split(/\s+/)
			.filter(Boolean)
			.filter((t) => t.length >= 3)
			.filter((t) => !STOP_WORDS.has(t));

		// Extract 1-word keywords (important single terms)
		tokens.forEach((token) => {
			if (token.length >= 4) {
				// Only meaningful single words (4+ chars)
				const normalized = token.trim();
				keywordFrequency.set(
					normalized,
					(keywordFrequency.get(normalized) || 0) + 1
				);
			}
		});

		// Extract 2-word phrases (most valuable for keyword research)
		for (let i = 0; i < tokens.length - 1; i++) {
			const phrase = `${tokens[i]} ${tokens[i + 1]}`;
			if (phrase.length >= 6 && phrase.length <= 40) {
				// Reasonable length
				const normalized = phrase.trim();
				keywordFrequency.set(
					normalized,
					(keywordFrequency.get(normalized) || 0) + 1
				);
			}
		}

		// Extract 3-word phrases (but limit to shorter ones)
		for (let i = 0; i < tokens.length - 2; i++) {
			const phrase = `${tokens[i]} ${tokens[i + 1]} ${
				tokens[i + 2]
			}`;
			if (phrase.length >= 10 && phrase.length <= 35) {
				// Keep 3-word phrases short
				const normalized = phrase.trim();
				keywordFrequency.set(
					normalized,
					(keywordFrequency.get(normalized) || 0) + 1
				);
			}
		}
	});

	// Filter out keywords longer than 3 words or too long
	const filteredKeywords = Array.from(keywordFrequency.entries()).filter(
		([keyword]) => {
			const wordCount = keyword.split(' ').length;
			return wordCount <= 3 && keyword.length <= 40; // Max 3 words, max 40 chars
		}
	);

	// Sort by frequency (most common keywords first), then by word count (prefer 2-word), then alphabetically
	const sortedKeywords = filteredKeywords
		.sort((a, b) => {
			// First sort by frequency (descending)
			if (b[1] !== a[1]) {
				return b[1] - a[1];
			}
			// Then by word count (prefer 2-word phrases, then 3-word, then 1-word)
			const aWords = a[0].split(' ').length;
			const bWords = b[0].split(' ').length;
			if (aWords !== bWords) {
				// Prefer 2-word > 3-word > 1-word
				if (aWords === 2) return -1;
				if (bWords === 2) return 1;
				if (aWords === 3) return -1;
				if (bWords === 3) return 1;
				return aWords - bWords;
			}
			// Finally alphabetically for consistency
			return a[0].localeCompare(b[0]);
		})
		.map(([keyword]) => keyword)
		.slice(0, maxKeywords);

	return sortedKeywords;
}

// Deterministic pseudo-metrics (no external calls) so the sample works offline.
// Replace with a real provider when wiring into your backend.
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h >>> 0;
}

const USE_SERVER = (import.meta as any).env?.VITE_KEYWORD_API_MODE === 'server';

// Get API base URL - works both client-side and server-side
const getApiBase = (): string => {
	// Check if we're running in Node.js (server-side)
	const isNode = typeof process !== 'undefined' && process.versions?.node;

	if (isNode) {
		// Server-side: use process.env
		const envBase =
			process.env.VITE_KEYWORD_API_BASE ||
			process.env.VITE_AGENT_API_BASE ||
			process.env.KEYWORD_API_BASE ||
			'';

		if (envBase) {
			return envBase.replace(/\/$/, '');
		}

		// Construct from PORT if available
		const port = process.env.PORT || '3001';
		const host = process.env.HOST || 'localhost';
		return `http://${host}:${port}`;
	} else {
		// Client-side: use import.meta.env
		const envBase =
			((import.meta as any).env?.VITE_KEYWORD_API_BASE as string) ||
			((import.meta as any).env?.VITE_AGENT_API_BASE as string) ||
			'';
		return envBase.replace(/\/$/, '');
	}
};

const API_BASE = getApiBase();

// ✨ Primary API - bloggr.ai keyword service
// ⚠️  NOTE: This API has CORS restrictions and will fail when called from localhost
//     or non-bloggr.ai domains. It will automatically fallback to alternative services.
async function getKeywordIdeasViaBloggrAI(
	keyword: string,
	country: string
): Promise<KwRow[]> {
	const r = await fetch('https://bloggr.ai:3011/getKeywords', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization:
				'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJmMDI5N2Q0Yy02M2QwLTRlOTEtYWZmZC1kMTYyNzRhODdhMjkiLCJlbWFpbCI6ImJoYXJhdC5yYWpAY3Jlb2xlc3R1ZGlvcy5jb20iLCJpYXQiOjE3NTgwMjYwODB9.Z6GN4aH5qF3srWDARBAr8IWBaqBbYzdzB34KqEsoTuU',
		},
		body: JSON.stringify({ keyword, country }),
	});

	if (!r.ok) throw new Error(`Bloggr AI API failed: ${r.status}`);

	const data = await r.json();

	// Transform the response to match KwRow format
	if (data.keywords && Array.isArray(data.keywords)) {
		return data.keywords.map((item: any) => ({
			text: String(item.keyword || item.text || ''),
			volume: Number(item.search_volume || item.volume || 0),
			difficulty:
				Number(
					item.keyword_difficulty || item.difficulty || 0
				) / 100, // normalize to 0..1
			source: 'seed',
		}));
	}

	// Fallback format if response structure is different
	return [];
}

// ✨ Google Ads REST API via server endpoint (uses OAuth2 token refresh)
async function getKeywordIdeasViaGoogleAdsServer(
	seed: string,
	location: string,
	urls?: string[] // Optional URLs to pass via urlSeed
): Promise<KwRow[]> {
	// Use API_BASE which now handles both client and server-side
	const baseUrl = API_BASE || 'http://localhost:3001';
	const apiUrl = `${baseUrl}/api/getKeywordsGoogleAds`;

	const requestBody: any = { location };

	// If URLs provided, use urlSeed (for primary keyword generation, don't combine with keyword seed)
	if (urls && urls.length > 0) {
		requestBody.urls = urls;
		// Don't include seed when URLs are provided for primary keyword generation
	} else if (seed) {
		// Only use seed if no URLs provided
		requestBody.seed = seed;
	}

	const r = await fetch(apiUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(requestBody),
	});

	if (!r.ok) {
		throw new Error(`Google Ads Server API failed: ${r.status}`);
	}

	const { rows } = await r.json();

	const keywords = (rows || []).map((it: any) => ({
		text: String(it.text || ''),
		volume: Number(it.volume || 0),
		difficulty: Number(it.difficulty ?? 0.5),
		source: urls && urls.length > 0 ? 'url' : 'seed',
	}));

	return keywords;
}

/**
 * Get keywords from URLs by passing URLs directly to Google Keyword API via urlSeed
 * Also includes user topic as keywordSeed for better results
 * @param urls Array of URLs to pass to Google Keyword API
 * @param location Target location for keyword research
 * @param userTopic Original user topic for context (used as keywordSeed)
 * @returns Array of keywords with volumes
 */
export async function getKeywordsFromUrls(
	urls: string[],
	location: string,
	userTopic: string
): Promise<KwRow[]> {
	if (!urls || urls.length === 0) return [];

	console.log(
		`   🔗 Getting 20 keywords from each of ${urls.length} URLs via Google Keyword API...`
	);

	// Aggregate keywords from all URLs
	const allKeywords: KwRow[] = [];

	// Process each URL (Google Ads API accepts one URL at a time via urlSeed)
	for (let i = 0; i < urls.length; i++) {
		const url = urls[i];
		try {
			console.log(
				`   📡 Fetching keywords for URL ${i + 1}/${
					urls.length
				}: ${url}`
			);

			// Pass URL directly via urlSeed only (no keyword seed for primary keyword generation)
			const keywords = await getKeywordIdeasViaGoogleAdsServer(
				'', // No keyword seed - only use URLs
				location,
				[url] // Pass URL via urlSeed
			);

			// Get top 20 from this URL (sorted by volume, no filtering)
			const top20FromUrl = keywords
				.sort((a, b) => b.volume - a.volume)
				.slice(0, 20);

			console.log(
				`   ✅ Got ${top20FromUrl.length} keywords from URL ${
					i + 1
				} (showing first 5): [${top20FromUrl
					.slice(0, 5)
					.map((k) => k.text)
					.join(', ')}...]`
			);
			allKeywords.push(...top20FromUrl);
		} catch (err) {
			console.error(
				`   ❌ Failed to fetch keywords for URL "${url}":`,
				err
			);
		}
	}

	// Deduplicate and return (in case same keyword appears from multiple URLs)
	const uniqueKeywords = dedupeMerge(allKeywords);
	console.log(
		`   ✅ Total unique keywords from all URLs: ${
			uniqueKeywords.length
		} (20 × ${urls.length} = ${urls.length * 20} max)`
	);

	return uniqueKeywords;
}

// Fallback API - original server (google-ads-api library)
async function getKeywordIdeasViaServer(
	seed: string,
	location: string
): Promise<KwRow[]> {
	const url = API_BASE ? `${API_BASE}/api/getKeywords` : '/api/getKeywords';
	const r = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ seed, location }),
	});
	if (!r.ok) throw new Error(`Keyword API failed: ${r.status}`);
	const { rows } = await r.json();
	return (rows || []).map((it: any) => ({
		text: String(it.text || ''),
		volume: Number(it.volume || 0),
		difficulty: Number(it.difficulty ?? 0.5),
		source: 'seed',
	}));
}

/**
 * Get volume for a specific keyword (exact match or close match)
 * Returns the keyword with its volume if found, or empty array if not found
 */
export async function getKeywordVolume(
	keyword: string,
	location: string
): Promise<KwRow | null> {
	const normalizedKeyword = keyword.toLowerCase().trim();

	// Try to get keyword ideas and find exact or close match
	try {
		const results = await getKeywordIdeasViaGoogleAdsServer(
			keyword,
			location
		);

		// Look for exact match first
		const exactMatch = results.find(
			(r) => r.text.toLowerCase().trim() === normalizedKeyword
		);
		if (exactMatch) {
			return exactMatch;
		}

		// Look for close match (same words, different order or slight variations)
		const keywordWords = new Set(normalizedKeyword.split(/\s+/));
		const closeMatch = results.find((r) => {
			const resultWords = new Set(
				r.text.toLowerCase().trim().split(/\s+/)
			);
			// Check if all words from keyword are in result
			let matchCount = 0;
			keywordWords.forEach((word) => {
				if (resultWords.has(word)) matchCount++;
			});
			// If 80%+ words match, consider it a close match
			return matchCount >= Math.ceil(keywordWords.size * 0.8);
		});

		if (closeMatch) {
			// Return with the original keyword text (not the API result text)
			return {
				...closeMatch,
				text: keyword, // Use original keyword text
			};
		}

		// If no match found, return null (will be filtered out)
		return null;
	} catch (e) {
		// Try bloggr.ai API as fallback
		try {
			const results = await getKeywordIdeasViaBloggrAI(
				keyword,
				location
			);
			const exactMatch = results.find(
				(r) => r.text.toLowerCase().trim() === normalizedKeyword
			);
			if (exactMatch) {
				return exactMatch;
			}

			// Try close match in bloggr results too
			const keywordWords = new Set(normalizedKeyword.split(/\s+/));
			const closeMatch = results.find((r) => {
				const resultWords = new Set(
					r.text.toLowerCase().trim().split(/\s+/)
				);
				let matchCount = 0;
				keywordWords.forEach((word) => {
					if (resultWords.has(word)) matchCount++;
				});
				return matchCount >= Math.ceil(keywordWords.size * 0.8);
			});

			if (closeMatch) {
				return {
					...closeMatch,
					text: keyword, // Use original keyword text
				};
			}

			return null;
		} catch (e2) {
			return null;
		}
	}
}

export async function getKeywordIdeas(
	seed: string,
	location: string
): Promise<KwRow[]> {
	// ✨ Priority 1: Try Google Ads REST API via server (HIGHEST PRIORITY)
	// Always try Google Ads API first
	try {
		const results = await getKeywordIdeasViaGoogleAdsServer(
			seed,
			location
		);
		if (results && results.length > 0) {
			return results;
		}
	} catch (e) {
		// Silent fallback
	}

	// ✨ Priority 2: Try bloggr.ai API
	try {
		const results = await getKeywordIdeasViaBloggrAI(seed, location);
		if (results && results.length > 0) {
			return results;
		}
	} catch (e) {
		// Silent fallback
	}

	// ✨ Priority 3: Fallback to original server API (google-ads-api library)
	if (USE_SERVER || API_BASE) {
		try {
			const results = await getKeywordIdeasViaServer(
				seed,
				location
			);
			return results;
		} catch (e) {
			// Silent fallback
		}
	}

	// ✨ Priority 4: Local simulation (no external API - LAST RESORT)
	// Produce a small set of variants with pseudo volumes/difficulties.
	const base = seed.trim();
	const variants = Array.from(
		new Set(
			[
				base,
				`${base} guide`,
				`${base} best practices`,
				`${base} tutorial`,
				`${base} benefits`,
				`${base} vs alternatives`,
				`${base} checklist`,
				`${base} for beginners`,
			].map((t) => t.toLowerCase())
		)
	);
	const rows: KwRow[] = variants.map((v, i) => {
		const h = hash(v + i.toString());
		const volume = 200 + (h % 7800); // 200..8000
		const difficulty = ((h >> 8) % 100) / 100; // 0..1
		return { text: v, volume, difficulty, source: 'seed' };
	});

	return rows;
}

export function dedupeMerge(rows: KwRow[]): KwRow[] {
	const map = new Map<string, KwRow>();
	rows.forEach((r) => {
		const k = r.text.trim().toLowerCase();
		const existing = map.get(k);
		if (!existing || r.volume > existing.volume) map.set(k, r);
	});
	return [...map.values()];
}

export function scoreIdeas(
	rows: KwRow[],
	title: string,
	prioritizeRelevance: boolean = false
): Array<KwRow & { score: number }> {
	if (!rows.length) return [] as any;
	const vols = rows.map((r) => r.volume);
	const diffs = rows.map((r) => r.difficulty);
	const minV = Math.min(...vols),
		maxV = Math.max(...vols);
	const minD = Math.min(...diffs),
		maxD = Math.max(...diffs);

	const sim = (kw: string) => {
		// Enhanced similarity calculation that better captures user intent
		const topicWords = new Set(
			(title || '')
				.toLowerCase()
				.split(/\W+/)
				.filter(Boolean)
				.filter((w) => w.length >= 3)
		);
		const kwWords = new Set(
			(kw || '')
				.toLowerCase()
				.split(/\W+/)
				.filter(Boolean)
				.filter((w) => w.length >= 3)
		);

		if (topicWords.size === 0 || kwWords.size === 0) return 0;

		// Count exact word matches
		let exactMatches = 0;
		kwWords.forEach((word) => {
			if (topicWords.has(word)) exactMatches++;
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
		return Math.min(1, 0.7 * exactScore + 0.3 * partialScore);
	};

	return rows
		.map((r) => {
			const volZ =
				maxV === minV ? 0.5 : (r.volume - minV) / (maxV - minV);
			const diffZ =
				maxD === minD
					? 0.5
					: (r.difficulty - minD) / (maxD - minD);
			const relevanceScore = sim(r.text);

			// Adjust weights based on prioritizeRelevance flag
			let s: number;
			if (prioritizeRelevance) {
				// Prioritize relevance/intent: 50% relevance, 30% volume, 20% difficulty
				s =
					0.5 * relevanceScore +
					0.3 * volZ +
					0.2 * (1 - diffZ);
			} else {
				// Original weights: 60% volume, 25% difficulty, 15% relevance
				s =
					0.6 * volZ +
					0.25 * (1 - diffZ) +
					0.15 * relevanceScore;
			}

			return { ...r, score: s };
		})
		.sort((a, b) => b.score - a.score);
}

export function formatCandidatesMarkdown(rows: KwRow[], top = 10): string {
	const header = `Here are the top keyword candidates with volumes (est.) and difficulty (0..1).\nReply with:\n- \"select primary: <keyword>\"\n- \"select secondaries: <kw1>, <kw2>, ...\"`;
	const lines = rows
		.slice(0, top)
		.map(
			(r, i) =>
				`${i + 1}. ${r.text} — volume: ${
					r.volume
				}, difficulty: ${r.difficulty.toFixed(2)}`
		);
	return [header, '', ...lines].join('\n');
}
