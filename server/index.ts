import express from 'express';
import cors from 'cors';
import { config as dotenvConfig } from 'dotenv';

// Load env early (supports running via `npm run serve:api` from project root)
dotenvConfig({ path: process.env.DOTENV_PATH || '.env.local' });

// Import token manager for Google Ads REST API
import { tokenManager } from './tokenManager.js';

// Lazy import to support ESM + CJS interop
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import gadsPkg from 'google-ads-api';
const GoogleAdsApi = gadsPkg?.GoogleAdsApi || gadsPkg?.default?.GoogleAdsApi;

// Basic mapping for common locations used in the Wizard
const GEO: Record<string, string> = {
	'United States': 'geoTargetConstants/2840',
	'United Kingdom': 'geoTargetConstants/2826',
	Canada: 'geoTargetConstants/2124',
	Australia: 'geoTargetConstants/2036',
};
const ENGLISH = 'languageConstants/1000';

// Deterministic fallback (mirrors client-side simulation) in case credentials are missing or API fails
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h >>> 0;
}
function simulateIdeas(seed: string) {
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
	return variants.map((v, i) => {
		const h = hash(v + i.toString());
		const volume = 200 + (h % 7800);
		const difficulty = ((h >> 8) % 100) / 100;
		return { text: v, volume, difficulty };
	});
}

const app = express();
app.use(express.json());
app.use(cors());

app.post('/api/getKeywords', async (req, res) => {
	const { seed, location } = req.body || {};
	if (!seed || typeof seed !== 'string') {
		return res
			.status(400)
			.json({ error: 'Missing required field: seed' });
	}
	const geo = GEO[location] || GEO['United States'];

	const {
		GOOGLE_ADS_DEVELOPER_TOKEN,
		GOOGLE_ADS_CLIENT_ID,
		GOOGLE_ADS_CLIENT_SECRET,
		GOOGLE_ADS_REFRESH_TOKEN,
		GOOGLE_ADS_CUSTOMER_ID,
		GOOGLE_ADS_LOGIN_CUSTOMER_ID,
	} = process.env as Record<string, string | undefined>;

	const haveCreds = !!(
		GOOGLE_ADS_DEVELOPER_TOKEN &&
		GOOGLE_ADS_CLIENT_ID &&
		GOOGLE_ADS_CLIENT_SECRET &&
		GOOGLE_ADS_REFRESH_TOKEN &&
		GOOGLE_ADS_CUSTOMER_ID
	);

	if (!haveCreds || !GoogleAdsApi) {
		// Fallback to deterministic ideas so the endpoint still works
		return res.json({ rows: simulateIdeas(seed) });
	}

	try {
		const api = new GoogleAdsApi({
			client_id: GOOGLE_ADS_CLIENT_ID!,
			client_secret: GOOGLE_ADS_CLIENT_SECRET!,
			developer_token: GOOGLE_ADS_DEVELOPER_TOKEN!,
		});

		const customer = api.Customer({
			customer_id: (GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, ''),
			refresh_token: GOOGLE_ADS_REFRESH_TOKEN!,
			login_customer_id: GOOGLE_ADS_LOGIN_CUSTOMER_ID
				? GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, '')
				: undefined,
		});

		// Try the Keyword Plan Ideas API via the wrapper; normalize output
		// Note: Library signatures can vary by version; we handle both common shapes
		let ideas: any[] = [];
		if (
			typeof (customer as any).keywordIdeas?.generate === 'function'
		) {
			ideas = await (customer as any).keywordIdeas.generate({
				customer_id: customer.cid,
				language_id: '1000',
				location_ids: [geo.split('/').pop()],
				keywords: [seed],
			});
		} else if (
			typeof (customer as any).keywordPlans
				?.generateKeywordIdeas === 'function'
		) {
			const resp = await (
				customer as any
			).keywordPlans.generateKeywordIdeas({
				customer_id: customer.cid,
				language: ENGLISH,
				geo_target_constants: [geo],
				keyword_seed: { keywords: [seed] },
			});
			ideas = Array.isArray(resp)
				? resp
				: resp?.results || resp?.keyword_ideas || [];
		} else {
			return res.status(500).json({
				error: 'Google Ads library does not expose a keyword ideas method in this runtime.',
			});
		}

		const rows = (ideas || [])
			.map((it: any) => {
				// Normalize common fields
				const text =
					it.text ||
					it.keyword ||
					it.keyword_text ||
					it?.keywordIdeaMetrics?.text ||
					'';
				const metrics =
					it.keyword_idea_metrics ||
					it.metrics ||
					it.keywordIdeaMetrics ||
					{};
				const avg =
					metrics.avg_monthly_searches ??
					metrics.avgMonthlySearches ??
					metrics.average_monthly_searches ??
					0;
				const comp =
					metrics.competition ??
					metrics.competition_index ??
					metrics.competitionIndex;
				// Normalize difficulty 0..1 from competition
				let difficulty = 0.5;
				if (typeof comp === 'number') {
					// If 0..100, scale; if 0..2 enum, map
					if (comp > 2)
						difficulty = Math.min(
							1,
							Math.max(0, comp / 100)
						);
					else difficulty = [0.2, 0.5, 0.8][comp] ?? 0.5;
				} else if (typeof comp === 'string') {
					const m: Record<string, number> = {
						LOW: 0.2,
						MEDIUM: 0.5,
						HIGH: 0.8,
					};
					difficulty = m[comp.toUpperCase()] ?? 0.5;
				}
				return { text, volume: Number(avg) || 0, difficulty };
			})
			.filter((r: any) => r.text);

		// If API returned empty, fallback to simulation
		if (!rows.length) return res.json({ rows: simulateIdeas(seed) });
		return res.json({ rows });
	} catch (err: any) {
		console.error('GAds keyword ideas error:', err?.message || err);
		return res.json({ rows: simulateIdeas(seed) });
	}
});

// 🔥 New endpoint: Google Ads REST API with OAuth2 token refresh
app.post('/api/getKeywordsGoogleAds', async (req, res) => {
	const { seed, location } = req.body || {};

	console.log(`\n${'═'.repeat(70)}`);
	console.log(`🚀 [SERVER] Google Ads REST API Request Received`);
	console.log(`${'═'.repeat(70)}`);
	console.log(`   📋 Seed Keyword: "${seed}"`);
	console.log(`   📍 Location: ${location}`);
	console.log(`   ⏰ Timestamp: ${new Date().toISOString()}`);
	console.log(`${'─'.repeat(70)}`);

	if (!seed || typeof seed !== 'string') {
		console.error(
			`   ❌ Validation Error: Missing or invalid seed keyword`
		);
		console.log(`${'═'.repeat(70)}\n`);
		return res
			.status(400)
			.json({ error: 'Missing required field: seed' });
	}

	const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
	const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
	const hasOAuthCreds = !!(
		process.env.CLIENT_ID &&
		process.env.CLIENT_SECRET &&
		process.env.REFRESH_TOKEN
	);

	console.log(`   🔐 Credential Check:`);
	console.log(`      - Customer ID: ${customerId ? '✓ Set' : '✗ Missing'}`);
	console.log(
		`      - Developer Token: ${developerToken ? '✓ Set' : '✗ Missing'}`
	);
	console.log(
		`      - OAuth Credentials: ${
			hasOAuthCreds ? '✓ Set' : '✗ Missing'
		}`
	);

	if (!customerId || !developerToken || !hasOAuthCreds) {
		console.error(
			`\n   ❌ ERROR: Missing required environment variables`
		);
		console.error(`   🔄 Falling back to simulated data\n`);
		console.log(`${'═'.repeat(70)}\n`);
		return res.status(503).json({
			error: 'Google Ads REST API credentials not configured',
			rows: simulateIdeas(seed),
		});
	}

	const url = `https://googleads.googleapis.com/v21/customers/${customerId}:generateKeywordIdeas`;
	const body = {
		customerId: customerId,
		includeAdultKeywords: false,
		keywordPlanNetwork: 'GOOGLE_SEARCH_AND_PARTNERS',
		keywordSeed: {
			keywords: [seed],
		},
		pageSize: 20,
	};

	console.log(`\n   📡 Making API Call to Google Ads...`);
	console.log(`      Endpoint: ${url}`);
	console.log(`      Network: GOOGLE_SEARCH_AND_PARTNERS`);
	console.log(`      Page Size: 20`);

	try {
		// Automatically get valid token (will refresh if expired)
		console.log(`   🔑 Getting OAuth2 access token...`);
		const startTokenTime = Date.now();
		const accessToken = await tokenManager.getValidToken();
		const tokenDuration = Date.now() - startTokenTime;
		console.log(`   ✅ Access token obtained (${tokenDuration}ms)`);

		console.log(`   📤 Sending request to Google Ads API...`);
		const startApiTime = Date.now();
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'developer-token': developerToken,
				Authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify(body),
		});
		const apiDuration = Date.now() - startApiTime;

		console.log(`\n   📥 API Response Received:`);
		console.log(
			`      Status: ${response.status} ${response.statusText}`
		);
		console.log(`      Duration: ${apiDuration}ms`);

		const data: any = await response.json();

		if (!response.ok) {
			const errorMessage =
				data.error?.message ||
				`API returned ${response.status}`;
			const errorCode = data.error?.code || response.status;
			console.error(`\n   ❌ ${'═'.repeat(66)}`);
			console.error(`   ❌ API ERROR`);
			console.error(`   ❌ ${'═'.repeat(66)}`);
			console.error(`      Error Code: ${errorCode}`);
			console.error(`      Error Message: ${errorMessage}`);
			if (data.error?.details) {
				console.error(
					`      Details: ${JSON.stringify(
						data.error.details,
						null,
						2
					)}`
				);
			}
			console.error(`   ❌ ${'═'.repeat(66)}\n`);
			console.log(`${'═'.repeat(70)}\n`);
			throw new Error(
				`Google Ads REST API failed: ${errorMessage}`
			);
		}

		if (data.results && data.results.length > 0) {
			console.log(`\n   ✅ ${'═'.repeat(66)}`);
			console.log(`   ✅ SUCCESS: Keywords Retrieved`);
			console.log(`   ✅ ${'═'.repeat(66)}`);
			console.log(`      Total Results: ${data.results.length}`);

			// Transform Google Ads response to match expected format
			const rows = data.results
				.map((result: any) => {
					const metrics = result.keywordIdeaMetrics || {};
					const text = result.text || '';
					const volume = metrics.avgMonthlySearches || 0;

					// Map competition to difficulty (0..1)
					let difficulty = 0.5;
					if (metrics.competitionIndex !== undefined) {
						difficulty = metrics.competitionIndex / 100;
					} else if (metrics.competition) {
						const compMap: Record<string, number> = {
							LOW: 0.25,
							MEDIUM: 0.5,
							HIGH: 0.75,
						};
						difficulty =
							compMap[metrics.competition] || 0.5;
					}

					return {
						text,
						volume: Number(volume) || 0,
						difficulty,
					};
				})
				.filter((kw: any) => kw.text.trim() !== '');

			console.log(`      Valid Keywords: ${rows.length}`);
			console.log(`\n   📊 Top 5 Results:`);
			rows.slice(0, 5).forEach((kw: any, idx: number) => {
				console.log(`      ${idx + 1}. "${kw.text}"`);
				console.log(
					`         Volume: ${kw.volume.toLocaleString()} searches/month`
				);
				console.log(
					`         Difficulty: ${(
						kw.difficulty * 100
					).toFixed(1)}%`
				);
			});
			console.log(`   ✅ ${'═'.repeat(66)}\n`);
			console.log(`${'═'.repeat(70)}\n`);

			return res.json({ rows });
		} else {
			console.warn(
				`\n   ⚠️  WARNING: No results returned from Google Ads API`
			);
			console.warn(`   🔄 Falling back to simulated data\n`);
			console.log(`${'═'.repeat(70)}\n`);
			return res.json({ rows: simulateIdeas(seed) });
		}
	} catch (error: any) {
		const errorMessage =
			error instanceof Error ? error.message : String(error);
		const errorStack = error instanceof Error ? error.stack : '';

		console.error(`\n   ❌ ${'═'.repeat(66)}`);
		console.error(`   ❌ EXCEPTION CAUGHT`);
		console.error(`   ❌ ${'═'.repeat(66)}`);
		console.error(`      Error: ${errorMessage}`);
		if (errorStack) {
			console.error(`      Stack Trace:`);
			errorStack
				.split('\n')
				.slice(0, 5)
				.forEach((line: string) => {
					console.error(`      ${line}`);
				});
		}
		console.error(`   ❌ ${'═'.repeat(66)}`);
		console.error(`   🔄 Returning simulated data as fallback\n`);
		console.log(`${'═'.repeat(70)}\n`);

		// Return simulated data as fallback
		return res.json({ rows: simulateIdeas(seed) });
	}
});

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
	// eslint-disable-next-line no-console
	console.log(`Keyword API listening on http://localhost:${PORT}`);
});
