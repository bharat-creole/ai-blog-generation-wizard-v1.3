import { BlogData } from '../types';

export type KwRow = {
  text: string;
  volume: number; // avg monthly searches
  difficulty: number; // 0..1 (higher = harder)
  source?: 'user' | 'seed';
};

// Heuristic seed extraction from a title/topic.
export function extractSeedsFromTitle(title: string, max = 3): string[] {
  const tokens = (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => t.length >= 4);
  // Prefer multi-word phrases if possible (very light heuristic)
  const phrases: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const two = `${tokens[i]} ${tokens[i + 1]}`.trim();
    if (two.split(' ').every((w) => w.length >= 3)) phrases.push(two);
  }
  const candidates = Array.from(new Set([...phrases, ...tokens]));
  return candidates.slice(0, Math.max(1, max));
}

// Deterministic pseudo-metrics (no external calls) so the sample works offline.
// Replace with a real provider when wiring into your backend.
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

const USE_SERVER = (import.meta as any).env?.VITE_KEYWORD_API_MODE === 'server';
const API_BASE = (((import.meta as any).env?.VITE_KEYWORD_API_BASE as string) || '').replace(/\/$/, '');

async function getKeywordIdeasViaServer(seed: string, location: string): Promise<KwRow[]> {
  const url = (API_BASE ? `${API_BASE}/api/getKeywords` : '/api/getKeywords');
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

export async function getKeywordIdeas(seed: string, _location: string): Promise<KwRow[]> {
  if (USE_SERVER) {
    try {
      return await getKeywordIdeasViaServer(seed, _location);
    } catch (e) {
      // fall through to local simulation if server not reachable
    }
  }
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

export function scoreIdeas(rows: KwRow[], title: string): Array<KwRow & { score: number }>
{
  if (!rows.length) return [] as any;
  const vols = rows.map((r) => r.volume);
  const diffs = rows.map((r) => r.difficulty);
  const minV = Math.min(...vols), maxV = Math.max(...vols);
  const minD = Math.min(...diffs), maxD = Math.max(...diffs);

  const sim = (kw: string) => {
    // very light token overlap similarity 0..1
    const a = new Set((title || '').toLowerCase().split(/\W+/).filter(Boolean));
    const b = new Set((kw || '').toLowerCase().split(/\W+/).filter(Boolean));
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    b.forEach((t) => { if (a.has(t)) inter++; });
    return Math.min(1, inter / Math.max(1, Math.min(a.size, b.size)));
  };

  return rows
    .map((r) => {
      const volZ = maxV === minV ? 0.5 : (r.volume - minV) / (maxV - minV);
      const diffZ = maxD === minD ? 0.5 : (r.difficulty - minD) / (maxD - minD);
      const s = 0.6 * volZ + 0.25 * (1 - diffZ) + 0.15 * sim(r.text);
      return { ...r, score: s };
    })
    .sort((a, b) => b.score - a.score);
}

export function formatCandidatesMarkdown(rows: KwRow[], top = 10): string {
  const header = `Here are the top keyword candidates with volumes (est.) and difficulty (0..1).\nReply with:\n- \"select primary: <keyword>\"\n- \"select secondaries: <kw1>, <kw2>, ...\"`;
  const lines = rows.slice(0, top).map((r, i) => `${i + 1}. ${r.text} — volume: ${r.volume}, difficulty: ${r.difficulty.toFixed(2)}`);
  return [header, '', ...lines].join('\n');
}