import { BlogData, Interlink, OutlineSection } from '../../types';
import * as geminiService from '../geminiService';
import * as agentService from '../agentService';

export type ReferencesUsage = 'both' | 'outline-only' | 'content-only';

export interface AgentState {
  data: BlogData;
  apiKey: string;
  outline: OutlineSection[];
  outlineApproved: boolean;
  draft: string;
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  progress: { sectionIndex: number };
  policy: { referencesUsage: ReferencesUsage; grounding: boolean };
  trace: { step: string; info?: Record<string, any>; at: number }[];
  halt?: { reason: string } | null;
  // Keyword research
  keywordResearch?: {
    primaryCandidates?: import('../keywordService').KwRow[];
    secondaryCandidates?: import('../keywordService').KwRow[];
    snapshot?: Record<string, any>;
  };
}

const appendTrace = (s: AgentState, step: string, info?: Record<string, any>) => {
  s.trace.push({ step, info, at: Date.now() });
};

export async function discoveryNode(s: AgentState): Promise<AgentState> {
  const shouldUseRefs = s.policy.referencesUsage === 'both' || s.policy.referencesUsage === 'outline-only';
  const input: BlogData = {
    ...s.data,
    outline: [],
    referenceUrls: shouldUseRefs ? s.data.referenceUrls : [],
  } as BlogData;
  const outline = await geminiService.generateOutline(input, s.apiKey);
  s.outline = outline;
  const outlineMd = [
    '## Outline',
    ...outline.map(sec => [
      `- ${sec.name}`,
      ...(sec.items?.map(it => `  - ${it.name}`) || [])
    ].join('\n'))
  ].join('\n');
  s.draft = s.draft ? `${outlineMd}\n\n${s.draft}` : outlineMd;
  appendTrace(s, 'DiscoveryNode.generatedOutline', { h2Count: outline.length });
  s.halt = { reason: 'awaiting_approval' };
  return s;
}

export async function estimatorNode(s: AgentState): Promise<AgentState> {
  if (!s.draft?.trim()) return s;
  await geminiService.rankBlogPost(s.draft, s.data.primaryKeyword, s.apiKey, 'gemini-flash-latest');
  appendTrace(s, 'EstimatorNode.ranked');
  return s;
}

export async function proposalNode(s: AgentState): Promise<AgentState> {
  if (!s.outlineApproved) return s;
  const idx = s.progress.sectionIndex ?? 0;
  if (idx >= s.outline.length) return s;
  const section = s.outline[idx];
  const useRefs = s.policy.referencesUsage === 'both' || s.policy.referencesUsage === 'content-only';
  const sectionMd = await agentService.generateSectionContent(
    s.data,
    section,
    s.apiKey,
    { targetKeyword: s.data.primaryKeyword, interlinks: s.data.interlinks as Interlink[], referenceUrls: useRefs ? s.data.referenceUrls : [] }
  );
  if ((useRefs && (s.data.referenceUrls?.length || 0) > 0)) {
    const used = s.data.referenceUrls.some(u => sectionMd.includes(u)) || /\[[0-9]+\]/.test(sectionMd) || /https?:\/\//.test(sectionMd);
    if (!used) {
      s.halt = { reason: 'references_not_used' };
      appendTrace(s, 'ProposalNode.pausedNoRefs', { section: section.name });
      return s;
    }
  }
  s.draft = s.draft ? `${s.draft}\n\n${sectionMd}` : sectionMd;
  s.progress.sectionIndex = idx + 1;
  appendTrace(s, 'ProposalNode.generatedSection', { sectionIndex: idx, section: section.name });
  return s;
}

export function route(s: AgentState): 'research_primary' | 'research_secondary' | 'discover' | 'await_approval' | 'proposal' | 'done' {
  // Primary keyword selected?
  if (!s.data.primaryKeyword?.trim()) return 'research_primary';
  // Secondary keywords present? (optional but recommended)
  if (!s.data.secondaryKeywords || s.data.secondaryKeywords.length === 0) return 'research_secondary';
  if (!s.outline || s.outline.length === 0) return 'discover';
  if (!s.outlineApproved) return 'await_approval';
  if ((s.progress.sectionIndex ?? 0) < s.outline.length) return 'proposal';
  return 'done';
}

import * as keywordTool from '../keywordService';

export async function researchPrimaryNode(s: AgentState): Promise<AgentState> {
  const seeds = [
    ...(s.data.primaryKeyword ? [s.data.primaryKeyword] : []),
    ...keywordTool.extractSeedsFromTitle(s.data.title || s.data.topic || '')
  ];
  const location = s.data.targetLocation || 'United States';
  const batches = await Promise.all(seeds.map((k) => keywordTool.getKeywordIdeas(k, location)));
  const merged = keywordTool.dedupeMerge(batches.flat());
  const ranked = keywordTool.scoreIdeas(merged, s.data.title || s.data.topic || '');
  s.keywordResearch = s.keywordResearch || {};
  s.keywordResearch.primaryCandidates = ranked;
  s.keywordResearch.snapshot = { seeds, location };
  s.halt = { reason: 'await_keyword_selection' };
  appendTrace(s, 'KeywordResearch.primaryCandidates', { count: ranked.length });
  return s;
}

export async function researchSecondaryNode(s: AgentState): Promise<AgentState> {
  const primary = (s.data.primaryKeyword || '').trim();
  if (!primary) return s; // guard
  const location = s.data.targetLocation || 'United States';
  const ideas = await keywordTool.getKeywordIdeas(primary, location);
  const merged = keywordTool.dedupeMerge(ideas);
  const ranked = keywordTool.scoreIdeas(merged, s.data.title || s.data.topic || '');
  s.keywordResearch = s.keywordResearch || {};
  s.keywordResearch.secondaryCandidates = ranked;
  s.halt = { reason: 'await_secondary_selection' };
  appendTrace(s, 'KeywordResearch.secondaryCandidates', { count: ranked.length });
  return s;
}

export async function runNext(s: AgentState): Promise<{ state: AgentState; halted: boolean; step: string }> {
  const r = route(s);
  if (r === 'research_primary') {
    const ns = await researchPrimaryNode(s);
    return { state: ns, halted: true, step: 'research_primary' };
  }
  if (r === 'research_secondary') {
    const ns = await researchSecondaryNode(s);
    return { state: ns, halted: true, step: 'research_secondary' };
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
    if (ns.halt) return { state: ns, halted: true, step: 'proposal' };
    const more = route(ns) === 'proposal';
    return { state: ns, halted: !more, step: 'proposal' };
  }
  appendTrace(s, 'Router.done');
  return { state: s, halted: true, step: 'done' };
}
