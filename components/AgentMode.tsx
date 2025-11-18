import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as agentService from '../services/agentService';
import { runNext as lgRunNext, AgentState } from '../services/langgraph/agentGraph';
import * as geminiService from '../services/geminiService';
import Spinner from './common/Spinner';
import { BlogData, Interlink, OutlineSection } from '../types';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface Props {
  data: BlogData;
  updateData: (data: Partial<BlogData>) => void;
}

const AgentMode: React.FC<Props> = ({ data, updateData }) => {
  const apiKey = data.apiKey;
  const interlinks: Interlink[] = data.interlinks;
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Hi! I\'m your Blog Agent. Tell me your goal, target audience, and tone. I will help plan and write the blog step-by-step, and I\'ll run live SEO checks as we go.'
    }
  ]);
  const [input, setInput] = useState('');
  const [draft, setDraft] = useState<string>(data.blogContent || '');
  const [keyword, setKeyword] = useState<string>(data.primaryKeyword || '');
  const [outline, setOutline] = useState<OutlineSection[]>(data.outline || []);
  const [outlineApproved, setOutlineApproved] = useState<boolean>(false);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState<boolean>(false);
  const [traceItems, setTraceItems] = useState<{ step: string; at: number }[]>([]);

  // SEO Ranker
  const [seoScore, setSeoScore] = useState<number | null>(null);
  const [seoPrimary, setSeoPrimary] = useState<string>('');
  const [seoCritical, setSeoCritical] = useState<string>('');
  const [isRanking, setIsRanking] = useState(false);

  // LangGraph agent orchestration state
  const [agent, setAgent] = useState<AgentState | null>(null);
  const [selectedSecondaries, setSelectedSecondaries] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const canSend = useMemo(() => !!input.trim() && !!apiKey, [input, apiKey]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  // Debounced SEO ranking
  useEffect(() => {
    if (!apiKey || !keyword.trim() || !draft.trim()) {
      setSeoScore(null);
      setSeoPrimary('');
      setSeoCritical('');
      return;
    }
    const handle = setTimeout(async () => {
      try {
        setIsRanking(true);
        const report = await geminiService.rankBlogPost(draft, keyword, apiKey, 'gemini-flash-latest');
        setSeoScore(report.finalSeoScore);
        setSeoPrimary(report.primaryRankingFactor);
        setSeoCritical(report.mostCriticalFlaw);
      } catch (e) {
        // swallow ranking errors to not block chat
      } finally {
        setIsRanking(false);
      }
    }, 800);
    return () => clearTimeout(handle);
  }, [draft, keyword, apiKey]);

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    if (!apiKey) {
      setError('Please set your Gemini API Key in the Wizard first.');
      return;
    }
    setError(null);
    const userMsg: ChatMessage = { role: 'user', content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsThinking(true);
    try {
      // Initialize agent state if this is the first actionable turn
      let working = agent ?? {
        data: { ...data },
        apiKey,
        outline: [...(data.outline || [])],
        outlineApproved: false,
        draft,
        messages: messages.concat(userMsg),
        progress: { sectionIndex: 0 },
        policy: { referencesUsage: 'both', grounding: true },
        trace: [],
        halt: null,
      } as AgentState;

      // If user typed "approve", treat as outline approval signal
      if (/\bapprove\b/i.test(userMsg.content)) {
        working.outlineApproved = true;
      }

      // Run the graph until it halts (keyword selection, outline approval, references issue, or completion)
      let guard = 0;
      while (guard++ < 20) {
        const { state: ns, halted } = await lgRunNext(working);
        working = ns;
        if (halted) break;
      }

      setAgent(working);
      setOutline(working.outline);
      setDraft(working.draft);
      setTraceItems(working.trace.map(t => ({ step: t.step, at: t.at })));
      updateData({ outline: working.outline, blogContent: working.draft, primaryKeyword: working.data.primaryKeyword, secondaryKeywords: working.data.secondaryKeywords });

      // Surface status messages based on halts
      if (working.halt?.reason === 'await_keyword_selection') {
        setMessages(prev => ([...prev, { role: 'assistant', content: 'Keyword candidates are ready. Please select a primary keyword below.' }]));
      } else if (working.halt?.reason === 'await_secondary_selection') {
        setMessages(prev => ([...prev, { role: 'assistant', content: 'Secondary keyword candidates are ready. Select up to 5 below.' }]));
      } else if (working.halt?.reason === 'awaiting_approval') {
        setMessages(prev => ([...prev, { role: 'assistant', content: 'Outline generated. Review the outline in the Live Draft and click "Approve outline" to proceed.' }]));
      } else if (working.halt?.reason === 'references_not_used') {
        setMessages(prev => ([...prev, { role: 'assistant', content: 'Paused: references were not incorporated in the last section. Provide alternative links or proceed without references.' }]));
      } else if ((working.progress.sectionIndex ?? 0) >= (working.outline?.length || 0) && (working.outline?.length || 0) > 0) {
        setMessages(prev => ([...prev, { role: 'assistant', content: 'Draft generation complete.' }]));
      }
    } catch (e: any) {
      setError(e?.message || 'Agent failed to respond.');
    } finally {
      setIsThinking(false);
    }
  }, [agent, apiKey, canSend, data, draft, messages, input, updateData]);

  const handleSaveToWizard = () => {
    updateData({ blogContent: draft, outline });
  };

  const handleGenerateOutline = async () => {
    // Deprecated: Prefer running via LangGraph. Kept for manual use if needed.
    if (!apiKey) { setError('Please set your Gemini API Key in the Wizard first.'); return; }
    setError(null);
    setIsThinking(true);
    try {
      const freshOutline = await geminiService.generateOutline({
        ...data,
        primaryKeyword: keyword,
        outline: [],
      }, apiKey);
      setOutline(freshOutline);
    } catch (e: any) {
      setError(e?.message || 'Failed to generate outline.');
    } finally {
      setIsThinking(false);
    }
  };

  const handleGenerateFullDraft = async () => {
    if (!apiKey) { setError('Please set your Gemini API Key in the Wizard first.'); return; }
    if (!outline || outline.length === 0) { setError('Generate and approve an outline first.'); return; }
    setError(null);
    setIsThinking(true);
    try {
      const content = await geminiService.generateBlogPost({
        ...data,
        primaryKeyword: keyword,
        interlinks,
      }, outline, apiKey);
      setDraft(content);
      updateData({ blogContent: content, outline });
    } catch (e: any) {
      setError(e?.message || 'Failed to generate full draft.');
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto bg-white rounded-lg shadow-2xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-3xl font-bold text-gray-800 mb-2">Agent Mode</h1>
      <p className="text-gray-600 mb-6">Chat to plan and write. Live SEO scoring helps optimize while you draft.</p>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
          {error}
        </div>
      )}

      {/* Keyword Research / Outline Approval Panels */}
      {agent?.halt?.reason === 'await_keyword_selection' && agent?.keywordResearch?.primaryCandidates && (
        <div className="mb-4 p-3 border rounded bg-amber-50">
          <div className="font-semibold mb-2">Keyword candidates (Primary)</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {agent.keywordResearch.primaryCandidates.slice(0, 10).map((r, idx) => (
              <div key={idx} className="flex items-center justify-between text-sm bg-white border rounded p-2">
                <div>
                  <div className="font-medium">{r.text}</div>
                  <div className="text-xs text-gray-500">Vol: {r.volume} · Diff: {r.difficulty.toFixed(2)}</div>
                </div>
                <button
                  className="px-2 py-1 text-xs bg-orange-500 text-white rounded"
                  onClick={async () => {
                    if (!agent) return;
                    const next = { ...agent, data: { ...agent.data, primaryKeyword: r.text } } as AgentState;
                    setAgent(next);
                    updateData({ primaryKeyword: r.text });
                    setIsThinking(true);
                    try {
                      let working = next;
                      let guard = 0;
                      while (guard++ < 20) {
                        const { state: ns, halted } = await lgRunNext(working);
                        working = ns;
                        if (halted) break;
                      }
                      setAgent(working);
                      setOutline(working.outline);
                      setDraft(working.draft);
                      setTraceItems(working.trace.map(t => ({ step: t.step, at: t.at })));
                      updateData({ outline: working.outline, blogContent: working.draft, secondaryKeywords: working.data.secondaryKeywords });
                      if (working.halt?.reason === 'await_secondary_selection') {
                        setMessages(prev => ([...prev, { role: 'assistant', content: 'Now select secondary keywords (up to 5).' }]));
                      }
                    } finally {
                      setIsThinking(false);
                    }
                  }}
                >Select</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {agent?.halt?.reason === 'await_secondary_selection' && agent?.keywordResearch?.secondaryCandidates && (
        <div className="mb-4 p-3 border rounded bg-amber-50">
          <div className="font-semibold mb-2">Keyword candidates (Secondary) — select up to 5</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {agent.keywordResearch.secondaryCandidates.slice(0, 12).map((r, idx) => {
              const checked = selectedSecondaries.includes(r.text);
              return (
                <label key={idx} className="flex items-center justify-between text-sm bg-white border rounded p-2 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setSelectedSecondaries((prev) => {
                          if (e.target.checked) {
                            const next = [...prev, r.text];
                            return next.slice(0, 5);
                          }
                          return prev.filter(x => x !== r.text);
                        });
                      }}
                    />
                    <div>
                      <div className="font-medium">{r.text}</div>
                      <div className="text-xs text-gray-500">Vol: {r.volume} · Diff: {r.difficulty.toFixed(2)}</div>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="mt-2">
            <button
              className="px-3 py-1 text-sm bg-orange-600 text-white rounded disabled:bg-orange-300"
              disabled={selectedSecondaries.length === 0}
              onClick={async () => {
                if (!agent) return;
                const next = { ...agent, data: { ...agent.data, secondaryKeywords: selectedSecondaries } } as AgentState;
                setAgent(next);
                updateData({ secondaryKeywords: selectedSecondaries });
                setIsThinking(true);
                try {
                  let working = next;
                  let guard = 0;
                  while (guard++ < 20) {
                    const { state: ns, halted } = await lgRunNext(working);
                    working = ns;
                    if (halted) break;
                  }
                  setAgent(working);
                  setOutline(working.outline);
                  setDraft(working.draft);
                  setTraceItems(working.trace.map(t => ({ step: t.step, at: t.at })));
                  updateData({ outline: working.outline, blogContent: working.draft });
                  if (working.halt?.reason === 'awaiting_approval') {
                    setMessages(prev => ([...prev, { role: 'assistant', content: 'Outline ready. Click "Approve outline" below to proceed.' }]));
                  }
                } finally {
                  setIsThinking(false);
                }
              }}
            >Confirm selection</button>
          </div>
        </div>
      )}

      {agent?.halt?.reason === 'awaiting_approval' && (
        <div className="mb-4 p-3 border rounded bg-blue-50">
          <div className="font-semibold mb-2">Outline generated</div>
          <div className="text-sm text-gray-700 mb-2">Review the outline shown in the Live Draft. Approve to start section-by-section generation.</div>
          <button
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded"
            onClick={async () => {
              if (!agent) return;
              const next = { ...agent, outlineApproved: true } as AgentState;
              setAgent(next);
              setOutlineApproved(true);
              setIsThinking(true);
              try {
                let working = next;
                let guard = 0;
                while (guard++ < 50) {
                  const { state: ns, halted } = await lgRunNext(working);
                  working = ns;
                  if (halted && working.halt?.reason !== undefined) break;
                }
                setAgent(working);
                setOutline(working.outline);
                setDraft(working.draft);
                setTraceItems(working.trace.map(t => ({ step: t.step, at: t.at })));
                updateData({ outline: working.outline, blogContent: working.draft });
                if ((working.progress.sectionIndex ?? 0) >= (working.outline?.length || 0)) {
                  setMessages(prev => ([...prev, { role: 'assistant', content: 'Draft generation complete.' }]));
                }
              } finally {
                setIsThinking(false);
              }
            }}
          >Approve outline</button>
        </div>
      )}

      {/* Trace Panel */}
      <div className="mt-4">
        <button onClick={() => setShowTrace(s => !s)} className="text-xs text-gray-600 underline">{showTrace ? 'Hide' : 'Show'} Trace</button>
        {showTrace && (
          <div className="mt-2 p-2 border rounded bg-gray-50 max-h-40 overflow-auto text-xs text-gray-700">
            {traceItems.length === 0 && <div>No steps yet.</div>}
            {traceItems.map((t, idx) => (
              <div key={idx}>{new Date(t.at).toLocaleTimeString()}: {t.step}</div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chat + Input */}
        <div className="flex flex-col h-[70vh]">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Keyword</label>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="e.g., database offerings by AWS"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500"
              />
            </div>
            
          </div>

          <div className="flex-1 overflow-y-auto border rounded-md p-3 bg-gray-50">
            {messages.map((m, i) => (
              <div key={i} className={`mb-3 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
                <div
                  className={`inline-block px-3 py-2 rounded-md text-sm whitespace-pre-wrap ${
                    m.role === 'user' ? 'bg-orange-500 text-white' : 'bg-white border'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {isThinking && (
              <div className="flex items-center gap-2 text-sm text-gray-500 mt-2">
                <Spinner className="w-4 h-4" />
                <span>Thinking...</span>
              </div>
            )}
            <div ref={scrollRef} />
          </div>

          <div className="mt-3 flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend && !isThinking) {
                    handleSend();
                  }
                }
              }}
              rows={2}
              placeholder="Ask the agent to plan, write a section, refine tone, add examples, etc."
              className="flex-1 p-2 border border-gray-300 rounded-md focus:ring-orange-500 focus:border-orange-500"
            />
            <button
              onClick={handleSend}
              disabled={!canSend || isThinking}
              className="px-5 py-2 text-sm font-semibold text-white bg-orange-500 rounded-md hover:bg-orange-600 disabled:bg-orange-300"
            >
              Send
            </button>
          </div>
        </div>

        {/* Draft + SEO */}
        <div className="flex flex-col h-[70vh]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold text-gray-800">Live Draft</h3>
            {isRanking ? (
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <Spinner />
                <span>Scoring SEO…</span>
              </div>
            ) : seoScore !== null ? (
              <div className="text-sm">
                <span className="font-semibold">SEO:</span> {seoScore}/100
              </div>
            ) : (
              <div className="text-sm text-gray-500">SEO score unavailable</div>
            )}
          </div>

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="flex-1 p-3 border rounded-md focus:ring-orange-500 focus:border-orange-500"
            placeholder="# Your Title\nStart drafting here..."
          />

          {seoScore !== null && (
            <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
              <div className="p-2 bg-blue-50 border border-blue-200 rounded">
                <span className="font-semibold">Primary Ranking Factor:</span> {seoPrimary || '—'}
              </div>
              <div className="p-2 bg-red-50 border border-red-200 rounded">
                <span className="font-semibold">Most Critical Flaw:</span> {seoCritical || '—'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentMode;
