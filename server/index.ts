import express from 'express';
import cors from 'cors';
import { config as dotenvConfig } from 'dotenv';

// Load env early (supports running via `npm run serve:api` from project root)
dotenvConfig({ path: process.env.DOTENV_PATH || '.env.local' });

// Lazy import to support ESM + CJS interop
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import gadsPkg from 'google-ads-api';
const GoogleAdsApi = (gadsPkg?.GoogleAdsApi) || (gadsPkg?.default?.GoogleAdsApi);

// Basic mapping for common locations used in the Wizard
const GEO: Record<string, string> = {
  'United States': 'geoTargetConstants/2840',
  'United Kingdom': 'geoTargetConstants/2826',
  'Canada': 'geoTargetConstants/2124',
  'Australia': 'geoTargetConstants/2036',
};
const ENGLISH = 'languageConstants/1000';

// Deterministic fallback (mirrors client-side simulation) in case credentials are missing or API fails
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h >>> 0; }
function simulateIdeas(seed: string) {
  const base = seed.trim();
  const variants = Array.from(new Set([
    base,
    `${base} guide`,
    `${base} best practices`,
    `${base} tutorial`,
    `${base} benefits`,
    `${base} vs alternatives`,
    `${base} checklist`,
    `${base} for beginners`,
  ].map(t => t.toLowerCase())));
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
    return res.status(400).json({ error: 'Missing required field: seed' });
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

  const haveCreds = !!(GOOGLE_ADS_DEVELOPER_TOKEN && GOOGLE_ADS_CLIENT_ID && GOOGLE_ADS_CLIENT_SECRET && GOOGLE_ADS_REFRESH_TOKEN && GOOGLE_ADS_CUSTOMER_ID);

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
      login_customer_id: GOOGLE_ADS_LOGIN_CUSTOMER_ID ? GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, '') : undefined,
    });

    // Try the Keyword Plan Ideas API via the wrapper; normalize output
    // Note: Library signatures can vary by version; we handle both common shapes
    let ideas: any[] = [];
    if (typeof (customer as any).keywordIdeas?.generate === 'function') {
      ideas = await (customer as any).keywordIdeas.generate({
        customer_id: customer.cid,
        language_id: '1000',
        location_ids: [geo.split('/').pop()],
        keywords: [seed],
      });
    } else if (typeof (customer as any).keywordPlans?.generateKeywordIdeas === 'function') {
      const resp = await (customer as any).keywordPlans.generateKeywordIdeas({
        customer_id: customer.cid,
        language: ENGLISH,
        geo_target_constants: [geo],
        keyword_seed: { keywords: [seed] },
      });
      ideas = Array.isArray(resp) ? resp : (resp?.results || resp?.keyword_ideas || []);
    } else {
      return res.status(500).json({ error: 'Google Ads library does not expose a keyword ideas method in this runtime.' });
    }

    const rows = (ideas || []).map((it: any) => {
      // Normalize common fields
      const text = it.text || it.keyword || it.keyword_text || it?.keywordIdeaMetrics?.text || '';
      const metrics = it.keyword_idea_metrics || it.metrics || it.keywordIdeaMetrics || {};
      const avg = metrics.avg_monthly_searches ?? metrics.avgMonthlySearches ?? metrics.average_monthly_searches ?? 0;
      const comp = metrics.competition ?? metrics.competition_index ?? metrics.competitionIndex;
      // Normalize difficulty 0..1 from competition
      let difficulty = 0.5;
      if (typeof comp === 'number') {
        // If 0..100, scale; if 0..2 enum, map
        if (comp > 2) difficulty = Math.min(1, Math.max(0, comp / 100));
        else difficulty = [0.2, 0.5, 0.8][comp] ?? 0.5;
      } else if (typeof comp === 'string') {
        const m: Record<string, number> = { LOW: 0.2, MEDIUM: 0.5, HIGH: 0.8 };
        difficulty = m[comp.toUpperCase()] ?? 0.5;
      }
      return { text, volume: Number(avg) || 0, difficulty };
    }).filter((r: any) => r.text);

    // If API returned empty, fallback to simulation
    if (!rows.length) return res.json({ rows: simulateIdeas(seed) });
    return res.json({ rows });
  } catch (err: any) {
    console.error('GAds keyword ideas error:', err?.message || err);
    return res.json({ rows: simulateIdeas(seed) });
  }
});

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Keyword API listening on http://localhost:${PORT}`);
});
