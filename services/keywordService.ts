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
export function generateIntentVariations(baseKeyword: string): string[] {
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

// Deterministic pseudo-metrics (no external calls) so the sample works offline.
// Replace with a real provider when wiring into your backend.
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h >>> 0;
}

const USE_SERVER = (import.meta as any).env?.VITE_KEYWORD_API_MODE === 'server';
const API_BASE = (
	((import.meta as any).env?.VITE_KEYWORD_API_BASE as string) || ''
).replace(/\/$/, '');

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
	location: string
): Promise<KwRow[]> {
	// Default to localhost:3001 if not set
	const baseUrl = API_BASE || 'http://localhost:3001';
	const url = `${baseUrl}/api/getKeywordsGoogleAds`;

	const r = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ seed, location }),
	});

	if (!r.ok) {
		throw new Error(`Google Ads Server API failed: ${r.status}`);
	}

	const { rows } = await r.json();

	const keywords = (rows || []).map((it: any) => ({
		text: String(it.text || ''),
		volume: Number(it.volume || 0),
		difficulty: Number(it.difficulty ?? 0.5),
		source: 'seed',
	}));

	return keywords;
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
	title: string
): Array<KwRow & { score: number }> {
	if (!rows.length) return [] as any;
	const vols = rows.map((r) => r.volume);
	const diffs = rows.map((r) => r.difficulty);
	const minV = Math.min(...vols),
		maxV = Math.max(...vols);
	const minD = Math.min(...diffs),
		maxD = Math.max(...diffs);

	const sim = (kw: string) => {
		// very light token overlap similarity 0..1
		const a = new Set(
			(title || '').toLowerCase().split(/\W+/).filter(Boolean)
		);
		const b = new Set(
			(kw || '').toLowerCase().split(/\W+/).filter(Boolean)
		);
		if (a.size === 0 || b.size === 0) return 0;
		let inter = 0;
		b.forEach((t) => {
			if (a.has(t)) inter++;
		});
		return Math.min(1, inter / Math.max(1, Math.min(a.size, b.size)));
	};

	return rows
		.map((r) => {
			const volZ =
				maxV === minV ? 0.5 : (r.volume - minV) / (maxV - minV);
			const diffZ =
				maxD === minD
					? 0.5
					: (r.difficulty - minD) / (maxD - minD);
			const s =
				0.6 * volZ + 0.25 * (1 - diffZ) + 0.15 * sim(r.text);
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
