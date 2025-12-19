import { AgentState } from '../state';

export type NormalizeResult = {
  topic?: string;
  queries?: string[];
  intent?: 'informational' | 'commercial' | 'transactional' | 'other';
  confidence?: number;
  trace?: any[];
};

/**
 * Lightweight normalize node.
 * Expands common acronyms and generates query variants for keyword research.
 */
export const normalizeTopicNode = async (
  state: AgentState
): Promise<NormalizeResult> => {
  const rawTopic = (state.data && state.data.topic) || '';
  const t = (rawTopic || '').trim();
  if (!t) {
    return { trace: [{ step: 'Normalize.no_topic', at: Date.now() }] };
  }

  const lower = t.toLowerCase();
  const map: Record<string, string> = {
    ai: 'Artificial intelligence',
    ml: 'Machine learning',
    nlp: 'Natural language processing',
    iot: 'Internet of Things',
    vr: 'Virtual reality',
    ar: 'Augmented reality',
  };

  const normalized = map[lower] || t;

  // Generate simple query variants. These are intentionally lightweight
  // and intended to be expanded later via a model-based query-expansion step.
  const queries = [
    `${normalized}`,
    `What is ${normalized}`,
    `Best ${normalized} tools`,
    `How to ${normalized} tutorial`,
    `Latest trends in ${normalized}`,
    `Benefits of ${normalized}`,
  ];

  // Detect basic search intent heuristically
  const informational = /what|how|why|benefits|tutorial|guide/i.test(t) ? 0.9 : 0.6;
  const commercial = /best|compare|top|price|buy|purchase/i.test(t) ? 0.8 : 0.2;
  const intent = informational >= commercial ? 'informational' : 'commercial';
  const confidence = Math.max(informational, commercial);

  return {
    topic: normalized,
    queries,
    intent: intent as any,
    confidence,
    trace: [{ step: 'Normalize.basic', info: { raw: rawTopic, normalized }, at: Date.now() }],
  };
};

export default normalizeTopicNode;
