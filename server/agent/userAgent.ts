import { PrimaryAgent } from './primaryAgent';
import { ContextManagerAgent } from './contextManagerAgent';
import { SecondaryAgent } from './secondaryAgent';
import { AgentState, defaultAgentState } from './state';
import { classifyIntent, UserIntent } from './intentClassifier';
import { researchPrimaryNode, researchSecondaryNode } from './nodes/research';
import { normalizeTopicNode } from './nodes/normalize';
import * as keywordTool from '../../services/keywordService';
import * as geminiService from '../../services/geminiService';
import { titleGenerationNode, discoveryNode } from './nodes/planning';
import { proposalNode, finalBlogGenerationNode } from './nodes/generation';
import { isValidTopic, isGibberish } from './validation';

export const __internal_isTopicOnlyInput = (args: {
  userMessage: string;
  currentState: AgentState;
  intent: UserIntent;
}): boolean => {
  const { userMessage, currentState, intent } = args;
  // If the user is just providing a generic topic (e.g. "Tennis"), do not
  // auto-infer a narrower query (e.g. "tennis live scores") via web-search.
  // This prevents the agent from drifting away from the user's intent.
  const msg = (userMessage || '').trim();
  const wordCount = msg ? msg.split(/\s+/).filter(Boolean).length : 0;
  const looksLikeQuestion = /\?\s*$/.test(msg) || /\b(what|how|why|when|where|which)\b/i.test(msg);
  const hasExplicitSubIntent = /\b(live|score|scores|results|news|ranking|rankings|tickets|stream|watch|tv)\b/i.test(msg);
  const isNewTopicStart = !currentState.data.topic;
  const isPartialInfoTopic = intent.type === 'partial_info' && !!(intent.extractedData && intent.extractedData.topic);
  return isNewTopicStart && isPartialInfoTopic && wordCount > 0 && wordCount <= 2 && !looksLikeQuestion && !hasExplicitSubIntent;
};

export const __internal_pickBestKeywordCandidate = (args: {
  candidates: any[];
  userInput: string;
}): string | null => {
  const { candidates, userInput } = args;
  const normalized = (userInput || '').trim().toLowerCase();
  if (!normalized) return null;
  const msgWords = normalized.split(/\s+/).filter(Boolean);
  if (msgWords.length === 0) return null;

  let best: { text: string; score: number } | null = null;
  for (const c of candidates || []) {
    const t = (typeof c === 'string' ? c : c && c.text) as string;
    if (!t) continue;
    const cand = t.trim().toLowerCase();
    if (!cand) continue;
    if (cand === normalized) return t.trim();

    const candWords = cand.split(/\s+/).filter(Boolean);
    const candSet = new Set(candWords);
    const overlap = msgWords.filter((w) => candSet.has(w)).length;
    const denom = Math.max(msgWords.length, candWords.length);
    const score = denom > 0 ? overlap / denom : 0;

    if (!best || score > best.score) best = { text: t.trim(), score };
  }

  if (!best) return null;
  return best.score >= 0.5 ? best.text : null;
};

/**
 * UserAgent — single stateful consultant that orchestrates the flow and
 * exposes the stepper node functions as stateless tools.
 */
export class UserAgent {
  private primary: PrimaryAgent;
  private context: ContextManagerAgent;
  private secondary: SecondaryAgent;

  constructor(private apiKey: string) {
    this.primary = new PrimaryAgent(apiKey);
    this.context = new ContextManagerAgent(apiKey);
    this.secondary = new SecondaryAgent(apiKey);
  }

  // Lightweight helper: infer possible meaning variants for a topic using top web titles and keyword helpers
  async inferTopicMeanings(topic: string): Promise<string[]> {
    try {
      const apiKey = this.apiKey || process.env.GEMINI_API_KEY;
      let titles: string[] = [];
      if (apiKey) {
        try {
          titles = await geminiService.searchWebForTitles(topic, apiKey);
        } catch (e) {
          // continue with empty titles
          console.warn('searchWebForTitles failed in inferTopicMeanings', e);
        }
      }
      // Attempt to extract seeds from titles via keywordTool helpers
      let seeds: string[] = [];
      if (titles && titles.length) {
        if ((keywordTool as any).extractKeywordsFromTitles) {
          try {
            seeds = (keywordTool as any).extractKeywordsFromTitles(titles, 8) || [];
          } catch (e) {
            console.warn('extractKeywordsFromTitles failed', e);
          }
        }
        if ((!seeds || seeds.length === 0) && (keywordTool as any).extractSeedsFromTitle) {
          try {
            seeds = titles.map((t: string) => (keywordTool as any).extractSeedsFromTitle(t, 3)).flat().filter(Boolean) as string[];
          } catch (e) {
            console.warn('extractSeedsFromTitle failed', e);
          }
        }
      }
      const candidates = [topic, ...(seeds || [])];
      // Optionally generate intent variations if helper exists
      let variations: string[] = [];
      if ((keywordTool as any).generateIntentVariations) {
        try {
          variations = (keywordTool as any).generateIntentVariations(candidates) || [];
        } catch (e) {
          console.warn('generateIntentVariations failed', e);
        }
      }
      const merged = Array.from(new Set([topic, ...variations, ...seeds].filter(Boolean)));
      return merged.slice(0, 8);
    } catch (err) {
      console.warn('inferTopicMeanings error', err);
      return [topic];
    }
  }

  // Lightweight extraction of a topic phrase from a user message
  detectTopicFromMessage(message: string): string {
    const quoted = message.match(/"([^"]+)"|'([^']+)'/);
    if (quoted) return quoted[1] || quoted[2];
    const onMatch = message.match(/(?:on|about)\s+([\w\s\-&]+)/i);
    if (onMatch) return onMatch[1].trim();
    const m = message.match(/(?:blog|write|article)\s+(?:on|about)\s+(.+)$/i);
    if (m && m[1]) return m[1].trim();
    const words = message.split(/\s+/).filter(Boolean);
    return words.slice(-2).join(' ');
  }

  /**
   * Main entry: handle a raw user message and return assistant response + state updates
   */
  async handleUserMessage(
    userMessage: string,
    currentState: AgentState
  ): Promise<{ assistantMessage: string; stateUpdates?: Partial<AgentState>; shouldRunStepper?: boolean }> {
    console.log(`🤖 [USER AGENT] handleUserMessage: "${userMessage.substring(0, 50)}..."`);

    const isValidKeyword = (kw: string | null | undefined): boolean => {
      if (!kw) return false;
      const t = kw.trim();
      if (t.length < 2) return false;
      if (isGibberish(t)) return false;
      if (!/[a-zA-Z]/.test(t)) return false;
      const tooManySpecialChars = (t.match(/[^a-zA-Z0-9\s]/g) || []).length > t.length * 0.35;
      if (tooManySpecialChars) return false;
      return true;
    };
    // Implement the authoritative flow here so UserAgent is the single
    // source of truth. This handles modification-detection, halt reasons,
    // intent classification, basic validations, and signals when the
    // stepper (nodes) should run.

    // Defensive: sometimes the frontend sends an incomplete state that can clear `halt`.
    // If the user explicitly sends a title selection, apply it even if we are not
    // currently halted on title selection.
    const explicitTitleMatch =
      userMessage.match(/Select\s+"([^"]+)"\s+as\s+title/i) ||
      userMessage.match(/Select\s+'([^']+)'\s+as\s+title/i) ||
      userMessage.match(/^\s*select\s+(.+?)\s+as\s+title\s*$/i) ||
      userMessage.match(/title:\s*(.+)/i);
    if (explicitTitleMatch && explicitTitleMatch[1]) {
      const selectedTitle = explicitTitleMatch[1].trim();
      if (selectedTitle) {
        const userProvidedFields = new Set<string>(
          Array.from((currentState.userProvidedFields || []) as any)
        );
        userProvidedFields.add('title');
        const stateUpdates: Partial<AgentState> = {
          data: { ...currentState.data, title: selectedTitle } as any,
          // Clear title options so the UI doesn't keep showing the title picker after selection
          titleOptions: [],
          halt: { reason: 'await_references_confirmation' },
          currentStep: 'references',
          userProvidedFields,
          titleSelected: true,
        };
        return {
          assistantMessage: `✅ Perfect! I've selected "${selectedTitle}" as your blog title.\n\nDo you want to add **reference links/files** for this blog?\n\n📌 **Note:** The reference links/files you provide will be used as source material to enhance your blog and ensure the content is well-researched and informative. If you don't provide references, we will use the best relevant internet knowledge available.\n\n Reply **Yes** to add references, or **Skip** to continue.`,
          stateUpdates,
          shouldRunStepper: false,
        };
      }
    }


    // Normalize short acronyms and common shorthand to full topic names.
    const normalizeTopic = (raw: string): string => {
      if (!raw) return raw;
      const t = raw.trim();
      const lower = t.toLowerCase();
      const map: Record<string, string> = {
        ai: 'Artificial intelligence',
        ml: 'Machine learning',
        nlp: 'Natural language processing',
        iot: 'Internet of Things',
        vr: 'Virtual reality',
        ar: 'Augmented reality',
      };
      if (map[lower]) return map[lower];
      // If the input looks like an acronym (all-caps, 2-4 chars), expand casing
      if (/^[A-Z]{2,4}$/.test(t)) return t.split('').join('').toUpperCase() === t ? t : t;
      return t;
    };

    const detectModificationRequest = (message: string): string | null => {
      const patterns: Record<string, RegExp[]> = {
        title: [
          /(?:change|modify|update|edit|redo)\s+(?:to\s+)?(?:the\s+)?title/i,
          /(?:want|need|give\s+me)\s+(?:a\s+)?(?:new|different)\s+title/i,
          /(?:title|titles)\s+(?:options|suggestions|variants)/i
        ],
        primaryKeyword: [
          /(?:change|modify|update|edit|redo)\s+(?:to\s+)?(?:the\s+)?(?:primary\s+)?keyword/i,
          /(?:want|need)\s+(?:a\s+)?(?:new|different)\s+keyword/i,
          /change\s+primary\s+keyword\s+to/i
        ],
        secondaryKeywords: [
          /(?:change|modify|update|edit|redo)\s+(?:to\s+)?(?:the\s+)?secondary\s+keywords/i,
          /(?:want|need)\s+(?:new|different)\s+secondary\s+keywords/i
        ],
        topic: [
          /(?:change|modify|update|edit|redo|switch)\s+(?:to\s+)?(?:the\s+)?topic/i,
          /(?:want|need|write\s+on|write\s+about|blog\s+on|blog\s+about)\s+(?:a\s+)?(?:new|different|instead\s+of)?\s*(?:topic|blog|article|post)?/i,
          /change\s+topic\s+to/i,
          /^change\s+to/i,
          /^write\s+(?:a\s+)?blog\s+(?:on|about)/i,
          /^lets\s+(?:write|start|create|begin)\s+(?:a\s+)?(?:blog|post|article)\s+(?:on|about)/i,
          /instead\s+of\s+this/i,
          /start\s+over/i,
          /reset\s+everything/i
        ],
      };
      for (const [field, regexList] of Object.entries(patterns)) {
        for (const regex of regexList) if (regex.test(message)) return field;
      }
      return null;
    };

    // --- 1) Handle modification requests first (priority) ---
    const modificationRequest = detectModificationRequest(userMessage);
    if (modificationRequest) {
      const fieldToStepMap: Record<string, 'topic' | 'primary_keyword' | 'secondary_keywords' | 'title'> = {
        topic: 'topic',
        primaryKeyword: 'primary_keyword',
        secondaryKeywords: 'secondary_keywords',
        title: 'title',
      };
      const targetStep = fieldToStepMap[modificationRequest] as any;
      const stateUpdates: Partial<AgentState> = { currentStep: targetStep, halt: null };
      if (modificationRequest === 'title') {
        stateUpdates.data = { ...currentState.data, title: undefined } as any;
        stateUpdates.outline = [];
        stateUpdates.outlineApproved = false;
        stateUpdates.titleOptions = [];
        stateUpdates.titleSelected = false;
      } else if (modificationRequest === 'primaryKeyword') {
        stateUpdates.data = { ...currentState.data, primaryKeyword: null, secondaryKeywords: [], title: undefined } as any;
        stateUpdates.outline = [];
        stateUpdates.outlineApproved = false;
        stateUpdates.keywordResearch = { ...currentState.keywordResearch, primaryCandidates: [], secondaryCandidates: [] };
      } else if (modificationRequest === 'secondaryKeywords') {
        stateUpdates.data = { ...currentState.data, secondaryKeywords: [], title: undefined } as any;
        stateUpdates.outline = [];
        stateUpdates.outlineApproved = false;
        stateUpdates.keywordResearch = { ...currentState.keywordResearch, secondaryCandidates: [] };
      } else if (modificationRequest === 'topic') {
        const directTopic = normalizeTopic(this.detectTopicFromMessage(userMessage).replace(/[.?!]$/, ''));

        if (directTopic && isValidTopic(directTopic)) {
          stateUpdates.data = { ...currentState.data, topic: directTopic, primaryKeyword: null, secondaryKeywords: [], title: undefined } as any;
          stateUpdates.keywordCandidates = [] as any;
          stateUpdates.keywordResearch = undefined;
          stateUpdates.titleOptions = [];
          stateUpdates.titleSelected = false;
          stateUpdates.outline = [];
          stateUpdates.outlineApproved = false;
          stateUpdates.outlineFeedback = undefined as any;
          stateUpdates.conversationContext = { ...(currentState.conversationContext || {} as any), normalizeQueries: [] } as any;
          stateUpdates.currentStep = 'primary_keyword' as any;
          stateUpdates.halt = null;
        } else {
          stateUpdates.data = { ...currentState.data, topic: undefined, primaryKeyword: null, secondaryKeywords: [], title: undefined } as any;
          stateUpdates.outline = [];
          stateUpdates.outlineApproved = false;
          stateUpdates.keywordResearch = undefined;
          stateUpdates.titleOptions = [];
        }
      }

      const isFirstTopic = modificationRequest === 'topic' && !currentState.data.topic;
      const assistantMessage = isFirstTopic
        ? `✅ Great! I've captured your topic: **"${stateUpdates.data?.topic || ''}"**.\n\n🔍 **Researching primary keywords...**`
        : `Sure, I'll help you do that. You will have to redo some steps again for better blog generation.`;

      return { assistantMessage, stateUpdates, shouldRunStepper: true };
    }

    // --- 2) Handle halt reasons (direct user inputs while halted) ---
    if (currentState.halt?.reason === 'await_keyword_selection') {
      let cleanedKeyword = userMessage.trim();
      const explicitPrimaryKeywordMatch =
        userMessage.match(/\buse\s+(.+?)\s+as\s+(?:the\s+)?primary\s+keyword\b/i) ||
        userMessage.match(/\bset\s+(.+?)\s+as\s+(?:the\s+)?primary\s+keyword\b/i) ||
        userMessage.match(/^\s*(.+?)\s+as\s+(?:the\s+)?primary\s+keyword\s*\.?\s*$/i) ||
        userMessage.match(/^\s*(.+?)\s+for\s+(?:the\s+)?primary\s+keyword\s*\.?\s*$/i) ||
        userMessage.match(/\bprimary\s+keyword\s+is\s+(.+?)\s*\.?\s*$/i) ||
        userMessage.match(/\bprimary\s+keyword\s*[:=]\s*(.+)$/i) ||
        userMessage.match(/^\s*primary\s+keyword\s+(.+)$/i);
      const hasExplicitPrimaryKeyword = !!(explicitPrimaryKeywordMatch && explicitPrimaryKeywordMatch[1]);
      if (hasExplicitPrimaryKeyword) {
        cleanedKeyword = String(explicitPrimaryKeywordMatch![1]).trim();
      }

      try {
        const apiKey = this.apiKey || process.env.GEMINI_API_KEY;
        if (apiKey) {
          console.log(`   [USER AGENT] Classifying intent for keyword selection...`);
          const intent = await classifyIntent(userMessage, currentState, apiKey);
          console.log(`   [USER AGENT] Intent: ${intent.type}, Delegated: ${intent.delegatedChoiceRequested}`);

          if (intent && intent.delegatedChoiceRequested) {
            const candidates = (currentState.keywordCandidates || []) as any[];
            const first = candidates && candidates.length > 0 ? candidates[0] : null;
            const pickedText = (typeof first === 'string' ? first : first && first.text) as string;
            if (pickedText && pickedText.trim()) {
              cleanedKeyword = pickedText.trim();
              console.log(`   [USER AGENT] Delegated pick: "${cleanedKeyword}"`);
            }
          } else if (intent?.extractedData?.primaryKeyword) {
            cleanedKeyword = intent.extractedData.primaryKeyword;
            console.log(`   [USER AGENT] Extracted from intent: "${cleanedKeyword}"`);
          }
        }
      } catch (err) {
        console.warn(`   [USER AGENT] Intent classification failed:`, err);
        // If classification fails, fall back to treating input as a literal value.
      }

      // Robust fallback (no trigger phrases): if we're halted on keyword selection and the
      // user's message doesn't match any presented candidate, interpret it as delegation
      // and pick from the candidate list.
      const primaryCandidates = (currentState.keywordCandidates || []) as any[];
      if (primaryCandidates.length > 0) {
        const normalizedMsg = cleanedKeyword.trim().toLowerCase();
        let matchesCandidate = primaryCandidates.some((c: any) => {
          if (!c) return false;
          const t = (typeof c === 'string' ? c : c && c.text) as string;
          if (!t) return false;
          const nt = t.trim().toLowerCase();
          const nm = normalizedMsg;
          // Flexible match: exact or stripped prefix or inclusion
          return nt === nm || nm === nt.replace(/^primary keyword:\s*/i, '') || nm.includes(nt);
        });

        if (!matchesCandidate) {
          const picked = __internal_pickBestKeywordCandidate({ candidates: primaryCandidates, userInput: cleanedKeyword });
          if (picked) {
            cleanedKeyword = picked;
            matchesCandidate = true;
          }
        }

        if (!matchesCandidate && !hasExplicitPrimaryKeyword) {
          console.log(`   [USER AGENT] Keyword "${cleanedKeyword}" not in candidates. Checking for navigation intent...`);
          try {
            const apiKey = this.apiKey || process.env.GEMINI_API_KEY;
            if (apiKey) {
              const intent = await classifyIntent(userMessage, currentState, apiKey);
              const extractedTopic = intent?.extractedData && (intent.extractedData as any).topic;
              const currentTopic = currentState.data && (currentState.data as any).topic;
              if (extractedTopic && typeof extractedTopic === 'string') {
                const t = extractedTopic.trim();
                if (t && isValidTopic(t) && (!currentTopic || t.toLowerCase() !== String(currentTopic).toLowerCase())) {
                  console.log(`   [USER AGENT] Detected topic change while selecting keyword. Delegating back.`);
                  return this.handleUserMessage(userMessage, { ...currentState, halt: null } as AgentState);
                }
              }
            }
          } catch (err) {
            console.warn(`   [USER AGENT] Intent check failed:`, err);
          }
        }
      }

      cleanedKeyword = cleanedKeyword.replace(/^primary\s+keyword\s*:?\s*/i, '');
      cleanedKeyword = cleanedKeyword.replace(/^keyword\s*:?\s*/i, '');
      if (cleanedKeyword.toLowerCase().startsWith('primary keyword ')) cleanedKeyword = cleanedKeyword.substring('primary keyword '.length);
      cleanedKeyword = cleanedKeyword.trim();

      if (!isValidKeyword(cleanedKeyword)) {
        return {
          assistantMessage:
            `I couldn't use **"${cleanedKeyword}"** as a keyword. Please pick one of the suggested keywords, or type a clear SEO keyword/phrase (e.g., "portable espresso maker", "best espresso maker for travel").`,
          stateUpdates: {
            halt: { reason: 'await_keyword_selection' },
            currentStep: 'primary_keyword' as any,
          },
          shouldRunStepper: false,
        };
      }

      const userProvidedFields = new Set(currentState.userProvidedFields || []);
      userProvidedFields.add('primaryKeyword');
      const stateUpdates: Partial<AgentState> = {
        data: { ...currentState.data, primaryKeyword: cleanedKeyword } as any,
        // Clear any stale candidate payloads so the UI doesn't re-show the primary picker
        // after the user has already confirmed a primary keyword.
        keywordCandidates: [],
        keywordResearch: {
          ...(currentState.keywordResearch || {} as any),
          primaryCandidates: [],
        } as any,
        halt: null,
        currentStep: 'secondary_keywords',
        userProvidedFields,
      };

      const picked = (currentState.keywordCandidates || []).find((c: any) => {
        if (!c) return false;
        if (typeof c === 'string') return c.trim().toLowerCase() === cleanedKeyword.toLowerCase();
        return typeof c.text === 'string' && c.text.trim().toLowerCase() === cleanedKeyword.toLowerCase();
      }) as any;
      const vol = picked && typeof picked === 'object' ? picked.volume : undefined;
      const diff = picked && typeof picked === 'object' ? picked.difficulty : undefined;
      const justificationParts: string[] = [];
      if (typeof vol === 'number') justificationParts.push(`volume: ${vol}`);
      if (typeof diff === 'number') justificationParts.push(`difficulty: ${diff}`);
      const justification = justificationParts.length > 0 ? ` (${justificationParts.join(', ')})` : '';

      return {
        assistantMessage: `✅ I'll use **"${cleanedKeyword}"** as the primary keyword${justification}.`,
        stateUpdates,
        shouldRunStepper: true,
      };
    }

    if (currentState.halt?.reason === 'await_references_selection') {
      const msg = userMessage.trim().toLowerCase();
      // UI often sends "Skip" / "Skip references".
      if (msg.includes('skip')) {
        return {
          assistantMessage: 'Skipped.\n\nDo you want to add any internal links to your existing content?\n\n📌 **Note:** Adding internal links will be helpful to embed internal links on the selected keyword, improving SEO and user navigation.\n\nReply **Yes** to add interlinks, or **Skip** to continue.',
          stateUpdates: {
            currentStep: 'interlinking',
            halt: { reason: 'await_interlinking_confirmation' },
            referencesCollected: true,
          } as any,
          shouldRunStepper: false,
        };
      }
      // UI sends something like: "Added 1 URL(s) and 0 file(s). Continue."
      if (msg.includes('continue') || msg.includes('added')) {
        return {
          assistantMessage: '✅ Got it. References saved.\n\nDo you want to add any internal links to your existing content?\n\n📌 **Note:** Adding internal links will be helpful to embed internal links on the selected keyword, improving SEO and user navigation.\n\nReply **Yes** to add interlinks, or **Skip** to continue.',
          stateUpdates: {
            currentStep: 'interlinking',
            halt: { reason: 'await_interlinking_confirmation' },
            referencesCollected: true,
          } as any,
          shouldRunStepper: false,
        };
      }
      // If user typed something else while on references, let the normal classifier handle it.
    }

    if (currentState.halt?.reason === 'await_references_confirmation') {
      const msg = userMessage.trim().toLowerCase();
      if (msg === 'yes' || msg === 'y' || msg.includes('yes')) {
        return {
          assistantMessage: 'Great — please add your reference URLs or upload files, then click Continue (or type Skip).',
          stateUpdates: {
            currentStep: 'references',
            halt: { reason: 'await_references_selection' },
          } as any,
          shouldRunStepper: false,
        };
      }
      if (msg.includes('skip') || msg === 'no' || msg === 'n') {
        return {
          assistantMessage: 'No problem.\n\nDo you want to add any internal links to your existing content?\n\n📌 **Note:** Adding internal links will be helpful to embed internal links on the selected keyword, improving SEO and user navigation.\n\nReply **Yes** to add interlinks, or **Skip** to continue.',
          stateUpdates: {
            currentStep: 'interlinking',
            halt: { reason: 'await_interlinking_confirmation' },
            referencesCollected: true,
          } as any,
          shouldRunStepper: false,
        };
      }
    }

    if (currentState.halt?.reason === 'await_interlinking_selection') {
      const msg = userMessage.trim().toLowerCase();
      if (msg.includes('skip')) {
        return {
          assistantMessage: 'Skipped. Generating your outline now...',
          stateUpdates: {
            currentStep: 'outline',
            halt: null,
            interlinkingCompleted: true,
          } as any,
          shouldRunStepper: true,
        };
      }
      if (msg.includes('continue') || msg.includes('added')) {
        return {
          assistantMessage: '✅ Got it. Interlinks saved. Generating your outline now...',
          stateUpdates: {
            currentStep: 'outline',
            halt: null,
            interlinkingCompleted: true,
          } as any,
          shouldRunStepper: true,
        };
      }
      // If user typed something else while on interlinking, let the normal classifier handle it.
    }

    if (currentState.halt?.reason === 'await_interlinking_confirmation') {
      const msg = userMessage.trim().toLowerCase();
      if (msg === 'yes' || msg === 'y' || msg.includes('yes')) {
        return {
          assistantMessage: 'Great — add your internal links (keyword + URL), then click Continue (or type Skip).',
          stateUpdates: {
            currentStep: 'interlinking',
            halt: { reason: 'await_interlinking_selection' },
          } as any,
          shouldRunStepper: false,
        };
      }
      if (msg.includes('skip') || msg === 'no' || msg === 'n') {
        return {
          assistantMessage: 'Skipped. Generating your outline now...',
          stateUpdates: {
            currentStep: 'outline',
            halt: null,
            interlinkingCompleted: true,
          } as any,
          shouldRunStepper: true,
        };
      }
    }

    if (currentState.halt?.reason === 'awaiting_approval') {
      const msg = userMessage.trim().toLowerCase();
      // Accept common approval phrases.
      if (
        msg === 'approve outline' ||
        msg === 'approve' ||
        msg === 'yes' ||
        msg === 'y' ||
        msg.includes('approve')
      ) {
        return {
          assistantMessage: '✅ **Outline approved!**\n\nStarting blog generation...',
          stateUpdates: {
            outlineApproved: true,
            halt: null,
            currentStep: 'outline',
          } as any,
          shouldRunStepper: true,
        };
      }

      // If user gives feedback instead of approval, store it for regeneration.
      // We keep halt cleared and trigger stepper so the outline regeneration runs.
      if (msg && msg.length > 0) {
        return {
          assistantMessage: '✍️ Got it — I\'ll update the outline based on your feedback.',
          stateUpdates: {
            outlineFeedback: userMessage.trim(),
            outlineApproved: false,
            halt: null,
            currentStep: 'outline',
          } as any,
          shouldRunStepper: true,
        };
      }
    }

    if (currentState.halt?.reason === 'await_title_selection') {
      let selectedTitle = userMessage.trim();

      const titleMatch =
        userMessage.match(/Select\s+"([^"]+)"\s+as\s+title/i) ||
        userMessage.match(/Select\s+'([^']+)'\s+as\s+title/i) ||
        userMessage.match(/\buse\s+(.+?)\s+as\s+(?:the\s+)?title\b/i) ||
        userMessage.match(/\bset\s+(.+?)\s+as\s+(?:the\s+)?title\b/i) ||
        userMessage.match(/\btitle\s+is\s+(.+?)\s*\.?\s*$/i) ||
        userMessage.match(/\bmy\s+title\s+is\s+(.+?)\s*\.?\s*$/i) ||
        userMessage.match(/\btitle\s*[:=]\s*(.+)$/i);
      if (titleMatch && titleMatch[1]) selectedTitle = titleMatch[1].trim();

      try {
        const apiKey = this.apiKey || process.env.GEMINI_API_KEY;
        if (apiKey) {
          const intent = await classifyIntent(userMessage, currentState, apiKey);
          if (intent && intent.delegatedChoiceRequested) {
            const options = ((currentState as any).titleOptions || []) as string[];
            const fallback = (currentState.data && currentState.data.title) || '';
            const auto = (options && options.length > 0 ? options[0] : fallback) as string;
            if (auto && auto.trim()) {
              selectedTitle = auto.trim();
            }
          }
        }
      } catch {
        // If classification fails, fall back to treating input as a literal value.
      }

      // Robust fallback (no trigger phrases): if we're halted on title selection and the
      // user's message doesn't match any presented option, interpret it as delegation
      // ONLY if it doesn't look like a modification request or other intent.
      const titleOptions = ((currentState as any).titleOptions || []) as string[];
      if (titleOptions.length > 0) {
        const normalizedMsg = selectedTitle.trim().toLowerCase();
        const matchesOption = titleOptions.some(
          (t) => typeof t === 'string' && t.trim().toLowerCase() === normalizedMsg
        );

        if (!matchesOption) {
          try {
            const apiKey = this.apiKey || process.env.GEMINI_API_KEY;
            if (apiKey) {
              const intent = await classifyIntent(userMessage, currentState, apiKey);
              const extractedTopic = intent?.extractedData && (intent.extractedData as any).topic;
              const currentTopic = currentState.data && (currentState.data as any).topic;
              if (extractedTopic && typeof extractedTopic === 'string') {
                const t = extractedTopic.trim();
                if (t && isValidTopic(t) && (!currentTopic || t.toLowerCase() !== String(currentTopic).toLowerCase())) {
                  console.log(`   [USER AGENT] Detected topic change while selecting title. Delegating back.`);
                  return this.handleUserMessage(userMessage, { ...currentState, halt: null } as AgentState);
                }
              }
            }
          } catch { }

          console.log(`   [USER AGENT] Title from user message not in options. Checking candidates...`);
          const nt = selectedTitle.trim().toLowerCase();
          const matches = titleOptions.some(opt => {
            if (!opt) return false;
            const no = opt.trim().toLowerCase();
            return no === nt || nt.includes(no) || no.includes(nt);
          });
          if (!matches && titleOptions.length > 0) {
            console.log(`   [USER AGENT] No flexible match for title, falling back to top option.`);
            selectedTitle = titleOptions[0];
          }
        }
      }
      const userProvidedFields = new Set<string>(Array.from(currentState.userProvidedFields || [] as any));
      userProvidedFields.add('title');
      const stateUpdates: Partial<AgentState> = {
        data: { ...currentState.data, title: selectedTitle } as any,
        // Clear title options so the UI doesn't keep showing the title picker after selection
        titleOptions: [],
        halt: { reason: 'await_references_confirmation' },
        currentStep: 'references',
        userProvidedFields,
        titleSelected: true,
      };
      return {
        assistantMessage:`✅ Perfect! I've selected "${selectedTitle}" as your blog title.\n\nDo you want to add **reference links/files** for this blog?\n\n📌 **Note:** The reference links/files you provide will be used as source material to enhance your blog and ensure the content is well-researched and informative. If you don't provide references, we will use the best relevant internet knowledge available.\n\n Reply **Yes** to add references, or **Skip** to continue.`,
        stateUpdates,
        shouldRunStepper: false,
      };
    }

    if (currentState.halt?.reason === 'await_secondary_selection') {
      let keywordText = userMessage.trim();

      let delegatedPick: any[] = [];
      try {
        const apiKey = this.apiKey || process.env.GEMINI_API_KEY;
        if (apiKey) {
          const intent = await classifyIntent(userMessage, currentState, apiKey);
          if (intent && intent.delegatedChoiceRequested) {
            const candidates = (currentState.keywordCandidates || []) as any[];
            const picked = candidates.slice(0, 3);
            const texts = picked
              .map((c) => (typeof c === 'string' ? c : c && c.text))
              .filter((t) => typeof t === 'string' && t.trim().length > 0) as string[];
            delegatedPick = picked;
            if (texts.length > 0) {
              keywordText = texts.join(', ');
            }
          }
        }
      } catch {
        // If classification fails, fall back to treating input as a literal value.
      }

      // Robust fallback (no trigger phrases): if we're halted on secondary selection and the
      // user's message doesn't match any presented candidate, interpret it as delegation
      // and pick the top 3 candidates.
      const secondaryCandidates = (currentState.keywordCandidates || []) as any[];
      if (secondaryCandidates.length > 0) {
        const normalizedMsg = keywordText.trim().toLowerCase();
        const matchesCandidate = secondaryCandidates.some((c: any) => {
          if (!c) return false;
          const t = (typeof c === 'string' ? c : c && c.text) as string;
          if (!t) return false;
          const nt = t.trim().toLowerCase();
          const nm = normalizedMsg;
          // Flexible match: exact or stripped prefix or inclusion
          return nt === nm || nm === nt.replace(/^secondary keywords?:\s*/i, '') || nm.includes(nt);
        });

        if (!matchesCandidate) {
          console.log(`   [USER AGENT] Secondary keywords "${keywordText}" not matched clearly. Checking for navigation intent...`);
          // Check if it's a known non-selection intent
          try {
            const apiKey = this.apiKey || process.env.GEMINI_API_KEY;
            if (apiKey) {
              const intent = await classifyIntent(userMessage, currentState, apiKey);
              if (intent.type === 'partial_info' || intent.type === 'refinement' || intent.type === 'full_automation') {
                console.log(`   [USER AGENT] Detected navigation intent "${intent.type}", delegating back.`);
                // It's likely a topic change or other request
                // IMPORTANT: clear halt first to avoid infinite recursion back into this same branch
                return this.handleUserMessage(userMessage, { ...currentState, halt: null } as AgentState);
              }
            }
          } catch (err) {
            console.warn(`   [USER AGENT] Intent check failed:`, err);
          }

          console.log(`   [USER AGENT] No navigation intent, falling back to top 3 candidates.`);
          const picked = secondaryCandidates.slice(0, 3);
          const texts = picked
            .map((c: any) => (typeof c === 'string' ? c : c && c.text))
            .filter((t: any) => typeof t === 'string' && t.trim().length > 0) as string[];
          delegatedPick = picked;
          if (texts.length > 0) {
            keywordText = texts.join(', ');
          }
        }
      }

      if (keywordText.toLowerCase().startsWith('secondary keywords:')) keywordText = keywordText.substring('secondary keywords:'.length).trim();
      const secondaryKeywords = keywordText.split(',').map((k) => k.trim()).filter((k) => k.length > 0);
      if (secondaryKeywords.length === 0) {
        return { assistantMessage: '❌ No keywords detected. Please provide at least one secondary keyword.', stateUpdates: {}, shouldRunStepper: false };
      }
      const userProvidedFields = new Set(currentState.userProvidedFields || []);
      userProvidedFields.add('secondaryKeywords');
      const stateUpdates: Partial<AgentState> = {
        data: { ...currentState.data, secondaryKeywords } as any,
        // Clear any stale candidate payloads so the UI doesn't re-show the secondary picker
        // after the user has already confirmed their selections.
        keywordCandidates: [],
        keywordResearch: {
          ...(currentState.keywordResearch || {} as any),
          secondaryCandidates: [],
        } as any,
        halt: null,
        currentStep: 'title',
        userProvidedFields,
      };

      const justificationBits: string[] = [];
      const asObjects = delegatedPick.filter((c) => c && typeof c === 'object');
      if (asObjects.length > 0) {
        const vols = asObjects.map((c) => c.volume).filter((v) => typeof v === 'number') as number[];
        if (vols.length > 0) justificationBits.push(`volumes: ${vols.join(', ')}`);
      }
      const justification = justificationBits.length > 0 ? ` (${justificationBits.join(', ')})` : '';

      return {
        assistantMessage: `✅ I'll use ${secondaryKeywords.length} secondary keyword${secondaryKeywords.length > 1 ? 's' : ''}: ${secondaryKeywords.join(', ')}${justification}.`,
        stateUpdates,
        shouldRunStepper: true,
      };
    }

    // --- 3) Fallback: classify intent and handle basic intents ---
    console.log(`   [USER AGENT] No halt matched. Classifying intent for fallback branches...`);
    const intent: UserIntent = await classifyIntent(userMessage, currentState, this.apiKey);
    console.log(`   [USER AGENT] Intent type: ${intent.type}`);

    // Merge any structured fields the classifier extracted (topic, primaryKeyword, title, etc.),
    // into the returned stateUpdates so the UserAgent progressively fills missing details
    // before invoking the stepper nodes.
    const extracted = intent.extractedData || {} as Partial<AgentState['data']>;
    const extractedStateUpdates: Partial<AgentState> = {};
    if (Object.keys(extracted).length > 0) {
      const normalizedExtracted: any = { ...(extracted as any) };
      if ((extracted as any).topic) {
        const candidateTopic = normalizeTopic((extracted as any).topic as string);
        if (candidateTopic && isValidTopic(candidateTopic) && !isGibberish(candidateTopic)) {
          normalizedExtracted.topic = candidateTopic;
        } else {
          delete normalizedExtracted.topic;
        }
      }
      if ((extracted as any).primaryKeyword) {
        const candidateKw = String((extracted as any).primaryKeyword);
        if (!isValidKeyword(candidateKw)) {
          delete normalizedExtracted.primaryKeyword;
        }
      }
      extractedStateUpdates.data = { ...currentState.data, ...normalizedExtracted } as any;
      const userProvided = new Set<string>(Array.from(currentState.userProvidedFields || [] as any));
      if (normalizedExtracted.primaryKeyword) userProvided.add('primaryKeyword');
      if (normalizedExtracted.secondaryKeywords) userProvided.add('secondaryKeywords');
      if (normalizedExtracted.title) userProvided.add('title');
      if (normalizedExtracted.topic) userProvided.add('topic');
      extractedStateUpdates.userProvidedFields = userProvided;
      extractedStateUpdates.halt = null; // Always clear halt when info is provided
    } else {
      // Fallback: try to heuristically extract topic phrases from plain user message
      const m = userMessage.match(/(?:blog|write|article)\s+(?:on|about)\s+(.+)$/i);
      if (m && m[1]) {
        const candidate = normalizeTopic(m[1].trim().replace(/[.?!]$/, ''));
        if (candidate && isValidTopic(candidate) && !isGibberish(candidate)) {
          extractedStateUpdates.data = { ...currentState.data, topic: candidate } as any;
          extractedStateUpdates.userProvidedFields = new Set<string>(Array.from(currentState.userProvidedFields || [] as any)).add('topic') as any;
          extractedStateUpdates.halt = null; // Always clear halt when info is provided
        }
      }
    }

    // If we now have a topic candidate, run the normalize node to produce
    // search-oriented query variants the research node can consume.
    const topicCandidate = (extractedStateUpdates.data && (extractedStateUpdates.data as any).topic) || currentState.data.topic;
    if (topicCandidate) {
      const isTopicOnlyInput = __internal_isTopicOnlyInput({ userMessage, currentState, intent });

      try {
        const normRes = await normalizeTopicNode({ ...currentState, data: { ...(currentState.data || {}), topic: topicCandidate } } as any);
        if (normRes.topic) {
          extractedStateUpdates.data = { ...(extractedStateUpdates.data || {}), topic: normRes.topic } as any;
        }
        // store the generated queries and intent into conversationContext for use by research
        extractedStateUpdates.conversationContext = { ...(currentState.conversationContext || {} as any), normalizeQueries: normRes.queries || [], normalizeIntent: normRes.intent, normalizeConfidence: normRes.confidence } as any;
        if (normRes.trace) extractedStateUpdates.trace = [...(currentState.trace || []), ...(normRes.trace as any)];
      } catch (err) {
        // non-fatal; continue without normalized queries
        console.error('normalizeTopicNode failed', err);
      }

      // --- New: Let UserAgent understand the topic via web results and infer the best research query
      if (!isTopicOnlyInput) {
        try {
          const apiKey = this.apiKey || process.env.GEMINI_API_KEY;
          if (apiKey) {
            const prefer = (extractedStateUpdates.conversationContext && (extractedStateUpdates.conversationContext as any).normalizeQueries && (extractedStateUpdates.conversationContext as any).normalizeQueries[0]) || topicCandidate;
            // 1) get urls
            const urls = await geminiService.searchWebForUrls(prefer, apiKey);
            if (urls && urls.length > 0) {
              // 2) ask Gemini to extract keywords from these URLs (urlContext)
              try {
                const extracted = await geminiService.extractKeywordsFromUrls(urls, topicCandidate, apiKey);
                if (extracted && extracted.length > 0) {
                  const unique = keywordTool.dedupeMerge(extracted as any[]);
                  const scored = keywordTool.scoreIdeas(unique, topicCandidate, true);
                  const inferred = (scored && scored.length > 0 && scored[0].text) || (unique[0] && (unique[0] as any).text);
                  if (inferred) {
                    const existing = (extractedStateUpdates.conversationContext && (extractedStateUpdates.conversationContext as any).normalizeQueries) || [];
                    extractedStateUpdates.conversationContext = { ...(extractedStateUpdates.conversationContext || {}), normalizeQueries: [inferred, ...existing] } as any;
                    extractedStateUpdates.data = { ...(extractedStateUpdates.data || {}), inferredPrimaryQuery: inferred } as any;
                  }
                } else {
                  // fallback: try to extract titles and derive seeds
                  const titles = await geminiService.searchWebForTitles(prefer, apiKey);
                  if (titles && titles.length > 0) {
                    const seeds = keywordTool.extractSeedsFromTitle(titles[0], 3);
                    const inferred = seeds && seeds.length > 0 ? seeds[0] : titles[0];
                    if (inferred) {
                      const existing = (extractedStateUpdates.conversationContext && (extractedStateUpdates.conversationContext as any).normalizeQueries) || [];
                      extractedStateUpdates.conversationContext = { ...(extractedStateUpdates.conversationContext || {}), normalizeQueries: [inferred, ...existing] } as any;
                      extractedStateUpdates.data = { ...(extractedStateUpdates.data || {}), inferredPrimaryQuery: inferred } as any;
                    }
                  }
                }
              } catch (e) {
                console.warn('topic understanding via urlContext failed', e);
              }
            }
          }
        } catch (e) {
          console.warn('topic inference failed', e);
        }
      }
    }

    // --- NEW: Infer meaning variants for the topic and proactively probe researchPrimary ---
    // If the classifier (or heuristics) produced a topic candidate, try to infer
    // alternate meanings (titles-derived, synonyms, seeds) and call researchPrimary
    // for each variant until we obtain keyword candidates. This keeps the UserAgent
    // authoritative over halting and avoids relying on a single raw topic string.
    if (topicCandidate && !currentState.data.primaryKeyword && (currentState.currentStep === 'topic' || currentState.currentStep === 'primary_keyword') && !intent.autoFillRequested && intent.type !== 'full_automation') {
      console.log(`   [USER AGENT] Proactively probing research variants for topic: "${topicCandidate}"...`);
      try {
        const variants = await this.inferTopicMeanings(topicCandidate);
        // ensure at least the canonical topic appears first
        const ordered = Array.from(new Set([topicCandidate, ...(variants || [])]));
        for (const v of ordered) {
          try {
            const probe = await this.researchPrimary({ topic: v, ...(extractedStateUpdates.conversationContext ? { conversationContext: extractedStateUpdates.conversationContext } : {}) });
            // If probe produced keywordCandidates or auto-selected primary keyword, use it
            if ((probe as any).keywordCandidates && (probe as any).keywordCandidates.length > 0) {
              // Merge data: keep any extracted data and prefer probe results
              const merged: any = { ...extractedStateUpdates, ...probe };
              merged.data = { ...(extractedStateUpdates.data || {}), ...(probe.data || {}) };
              return { assistantMessage: "Let's proceed with your blog.", stateUpdates: merged, shouldRunStepper: false };
            }
            if ((probe as any).data && (probe as any).data.primaryKeyword) {
              const merged: any = { ...extractedStateUpdates, ...probe };
              merged.data = { ...(extractedStateUpdates.data || {}), ...(probe.data || {}) };
              return { assistantMessage: "Let's proceed with your blog.", stateUpdates: merged, shouldRunStepper: false };
            }
          } catch (e) {
            // probe failed for this variant, continue to next
            console.warn('researchPrimary probe failed for variant', v, e);
          }
        }
        // nothing found: attach inferred variants to conversationContext.normalizeQueries
        extractedStateUpdates.conversationContext = { ...(extractedStateUpdates.conversationContext || {}), normalizeQueries: ordered.concat((extractedStateUpdates.conversationContext && (extractedStateUpdates.conversationContext as any).normalizeQueries) || []) } as any;
      } catch (e) {
        console.warn('inferTopicMeanings failed', e);
      }
    }

    switch (intent.type) {
      case 'greeting':
        if (currentState && (currentState.data.topic || currentState.data.primaryKeyword || currentState.data.title || (currentState.data.secondaryKeywords || []).length > 0)) {
          return { assistantMessage: `Hello! 👋 Nice to hear from you again!\n\nLet's continue with your blog.`, stateUpdates: {}, shouldRunStepper: false };
        }
        return { assistantMessage: 'Hello! 👋 I\'m your Blog Agent. Tell me what topic you\'d like to write about, or say **"generate blog automatically"** to let me handle everything!', stateUpdates: {}, shouldRunStepper: false };
      case 'help_request':
        return { assistantMessage: "I'm your AI Blog Agent! 🤖 I can help you:\n\n✍️ **Create SEO-Optimized Blogs**\n🔍 **Keyword Research**\n📝 **Title Generation**\n📋  **Content Outlines**\n\nJust tell me your blog topic to get started!", stateUpdates: {}, shouldRunStepper: false };
      case 'off_topic':
        if (currentState && (currentState.data.topic || currentState.data.primaryKeyword || currentState.data.title || (currentState.data.secondaryKeywords || []).length > 0)) {
          return { assistantMessage: "I'm specifically designed to help you create blog content! 📝\n\nLet's continue with your blog. What would you like to do next?", stateUpdates: {}, shouldRunStepper: false };
        }
        return { assistantMessage: "I'm specifically designed to help you create blog content! 📝\n\nPlease provide a clear, meaningful blog topic to get started.\n\n**Examples:**\n- 'Cloud computing'\n- 'Machine learning'\n- 'Web development best practices'", stateUpdates: {}, shouldRunStepper: false };
      case 'approval':
        // Approve outline or step — trigger appropriate stepper
        if (currentState.currentStep === 'outline_confirmation' || currentState.halt?.reason === 'await_outline_start_confirmation') {
          return { assistantMessage: '📋 **Generating your blog outline...**\n\nI\'m creating a comprehensive outline that structures your content logically and covers all key points based on your topic and keywords.', stateUpdates: { currentStep: 'outline', halt: null }, shouldRunStepper: true };
        }
        if (currentState.halt?.reason === 'awaiting_approval') {
          return { assistantMessage: '✅ **Outline approved!**\n\nStarting blog generation...', stateUpdates: {}, shouldRunStepper: true };
        }
        return { assistantMessage: 'OK — noted.', stateUpdates: {}, shouldRunStepper: false };
      default:
        // For other intents (full_automation, partial_info, refinement, skip_step, etc.)
        // prefer to apply any extracted data from the classifier, then run the stepper.
        if (intent.type === 'full_automation' || intent.autoFillRequested) {
          console.log('🤖 [USER AGENT] Full automation requested. Running proactive automation...');
          const automationUpdates = await this.runProactiveAutomation({
            ...(currentState.data || {}),
            ...((extracted as any) || {})
          }, currentState);

          return {
            assistantMessage: "I'll handle everything automatically! Generating your blog now...",
            stateUpdates: {
              ...extractedStateUpdates,
              ...automationUpdates,
              preferences: {
                ...currentState.preferences,
                automationLevel: 'full'
              },
              halt: null
            },
            shouldRunStepper: true
          };
        }

        // If we extracted a new topic, or if we're advancing from a halted state
        if (topicCandidate && topicCandidate !== currentState.data.topic) {
          return {
            assistantMessage: `✅ Great! I've captured your topic: '${topicCandidate}'.\n\n🔍 **Researching primary keywords...**`,
            stateUpdates: {
              ...extractedStateUpdates,
              currentStep: 'primary_keyword',
              halt: null
            },
            shouldRunStepper: true,
          };
        }

        return {
          assistantMessage: "Let's proceed with your blog.",
          stateUpdates: {
            ...extractedStateUpdates,
            halt: null
          },
          shouldRunStepper: true
        };
    }
  }

  async runProactiveAutomation(data: Partial<AgentState['data']>, currentState: AgentState): Promise<Partial<AgentState>> {
    console.log(`🤖 [USER AGENT] Starting runProactiveAutomation...`);
    // Ensure Set fields are actual Sets (not Arrays from serialization)
    const userProvidedFields = currentState.userProvidedFields instanceof Set
      ? currentState.userProvidedFields
      : new Set<string>(currentState.userProvidedFields || []);

    const autoFillFields = currentState.autoFillFields instanceof Set
      ? currentState.autoFillFields
      : new Set<string>(currentState.autoFillFields || []);

    let internalState: Partial<AgentState> = {
      ...currentState,
      data: { ...currentState.data, ...data },
      userProvidedFields,
      autoFillFields
    };

    const updates: Partial<AgentState> = { data: { ...internalState.data } as any };

    // 1. Research Primary Keyword
    if (!internalState.data?.primaryKeyword) {
      console.log('   🔍 [PROACTIVE] Researching Primary Keyword...');
      const res = await this.researchPrimary(internalState.data || {}, internalState);
      console.log(`   🔍 [PROACTIVE] Primary Keyword Research Done. Res:`, !!res.data?.primaryKeyword || !!(res as any).keywordCandidates);
      if (res.data?.primaryKeyword) {
        updates.data!.primaryKeyword = res.data.primaryKeyword;
        internalState.data!.primaryKeyword = res.data.primaryKeyword;
      } else if ((res as any).keywordCandidates && (res as any).keywordCandidates.length > 0) {
        const top = (res as any).keywordCandidates[0];
        const text = typeof top === 'string' ? top : top.text;
        updates.data!.primaryKeyword = text;
        internalState.data!.primaryKeyword = text;
      }
    }

    // 2. Research Secondary Keywords
    if (!internalState.data?.secondaryKeywords || internalState.data.secondaryKeywords.length === 0) {
      console.log('   🔍 [PROACTIVE] Researching Secondary Keywords...');
      const res = await this.researchSecondary(internalState.data || {}, internalState);
      if (res.data?.secondaryKeywords) {
        updates.data!.secondaryKeywords = res.data.secondaryKeywords;
        internalState.data!.secondaryKeywords = res.data.secondaryKeywords;
      } else if ((res as any).keywordCandidates && (res as any).keywordCandidates.length > 0) {
        const top5 = (res as any).keywordCandidates.slice(0, 5).map((c: any) => typeof c === 'string' ? c : c.text);
        updates.data!.secondaryKeywords = top5;
        internalState.data!.secondaryKeywords = top5;
      }
    }

    // 3. Generate Title
    if (!internalState.data?.title) {
      console.log('   🔍 [PROACTIVE] Generating Title...');
      const res = await this.generateTitles(internalState);
      if (res.data?.title) {
        updates.data!.title = res.data.title;
      } else if ((res as any).titleOptions && (res as any).titleOptions.length > 0) {
        updates.data!.title = (res as any).titleOptions[0];
      }
    }

    // Set step to outline so the graph knows where to start
    updates.currentStep = 'outline';
    updates.halt = null;

    return updates;
  }

  // ----- Stepper tool wrappers (stateless interfaces for nodes) -----
  async researchPrimary(blogData: Partial<AgentState['data']>, ctx?: Partial<AgentState>): Promise<Partial<AgentState>> {
    const tmpState: any = { data: blogData || {}, apiKey: this.apiKey, ...ctx };
    const res: any = await researchPrimaryNode(tmpState as AgentState);
    const updates: Partial<AgentState> = {};
    const dataUpdates = res.data || res.dataUpdates;
    if (dataUpdates) updates.data = { ...((tmpState.data as any) || {}), ...dataUpdates } as any;
    if (res.autoSelected) {
      updates.currentStep = 'primary_keyword';
      updates.halt = null;
    } else if (res.keywordCandidates) {
      updates.halt = { reason: 'await_keyword_selection' } as any;
      (updates as any).keywordCandidates = res.keywordCandidates;
      updates.currentStep = 'primary_keyword';
    } else if (res.errorReason) {
      if (res.errorReason === 'no_topic_provided') {
        updates.halt = { reason: 'no_topic_provided' } as any;
        updates.currentStep = 'topic';
      } else if (res.errorReason === 'invalid_topic') {
        updates.halt = { reason: 'invalid_topic' } as any;
      }
    }
    if (res.toolOutputs) (updates as any).toolOutputs = res.toolOutputs;
    if (res.trace) (updates as any).trace = res.trace;
    if (res.messages) (updates as any).messages = res.messages;
    // --- FALLBACK: If research node returned no candidates, run all fallbacks in parallel
    const hadNoCandidates = !res.keywordCandidates && !(res.autoSelected) && res.errorReason === 'no_keywords_found';
    if (hadNoCandidates) {
      const aggregatedToolOutputs: any[] = [];
      const aggregatedTrace: any[] = [];
      const candidateBuckets: any[][] = [];
      const apiKey = tmpState.apiKey || process.env.GEMINI_API_KEY;
      const location = (tmpState.data && tmpState.data.targetLocation) || (tmpState.conversationContext && tmpState.conversationContext.location) || 'United States';

      // Task A: Probe normalized query variants with researchPrimaryNode in parallel
      const variants: string[] = (tmpState.conversationContext && tmpState.conversationContext.normalizeQueries) || [];
      const variantTask = (async () => {
        if (!variants || variants.length === 0) return [] as any[];
        try {
          const probes = await Promise.allSettled(
            variants.map((variant) => {
              const probeState = { ...(tmpState as any), data: { ...(tmpState.data || {}), topic: variant } } as AgentState;
              return researchPrimaryNode(probeState as AgentState);
            })
          );
          const found: any[] = [];
          probes.forEach((p, idx) => {
            if (p.status === 'fulfilled' && (p.value as any).keywordCandidates && (p.value as any).keywordCandidates.length > 0) {
              found.push(...(p.value as any).keywordCandidates);
              if ((p.value as any).trace) aggregatedTrace.push({ step: 'fallback.normalizedQuery', info: { variant: variants[idx] }, trace: (p.value as any).trace });
              if ((p.value as any).toolOutputs) aggregatedToolOutputs.push({ type: 'fallback.normalizedQuery', data: (p.value as any).toolOutputs });
            }
          });
          return found;
        } catch (err) {
          console.warn('variantTask failed', err);
          return [] as any[];
        }
      })();

      // Task B: Seed extraction from title -> getKeywordIdeas in parallel
      const seedTask = (async () => {
        const mergedRows: any[] = [];
        const title = tmpState.data && tmpState.data.title;
        if (!title) return [] as any[];
        try {
          const seeds = keywordTool.extractSeedsFromTitle(title, 6);
          aggregatedTrace.push({ step: 'fallback.titleSeeds', info: { seeds } });
          const batches = await Promise.allSettled(seeds.slice(0, 6).map((s) => keywordTool.getKeywordIdeas(s, location)));
          batches.forEach((b, i) => {
            if (b.status === 'fulfilled' && Array.isArray(b.value) && b.value.length > 0) {
              mergedRows.push(...b.value);
              aggregatedToolOutputs.push({ type: 'fallback.seedIdeas', seed: seeds[i], count: b.value.length });
            }
          });
          if (mergedRows.length === 0) return [] as any[];
          const unique = keywordTool.dedupeMerge(mergedRows);
          const scored = keywordTool.scoreIdeas(unique, tmpState.data.topic || tmpState.data.title || '', true);
          return scored.slice(0, 25);
        } catch (err) {
          console.warn('seedTask failed', err);
          return [] as any[];
        }
      })();

      // Task C: Extract keywords from web titles -> getKeywordIdeas in parallel
      const titlesTask = (async () => {
        if (!apiKey) return [] as any[];
        try {
          const titles = await geminiService.searchWebForTitles(tmpState.data.topic || tmpState.data.title || '', apiKey);
          aggregatedTrace.push({ step: 'fallback.webTitles', info: { count: (titles || []).length } });
          const extracted = keywordTool.extractKeywordsFromTitles(titles || [], 40);
          aggregatedTrace.push({ step: 'fallback.extractKeywordsFromTitles', info: { extractedCount: extracted.length } });
          const slices = extracted.slice(0, 10);
          const batches = await Promise.allSettled(slices.map((k) => keywordTool.getKeywordIdeas(k, location)));
          const merged: any[] = [];
          batches.forEach((b, i) => {
            if (b.status === 'fulfilled' && Array.isArray(b.value) && b.value.length > 0) {
              merged.push(...b.value);
              aggregatedToolOutputs.push({ type: 'fallback.titleSeedIdeas', seed: slices[i], count: b.value.length });
            }
          });
          if (merged.length === 0) return [] as any[];
          const unique = keywordTool.dedupeMerge(merged);
          const scored = keywordTool.scoreIdeas(unique, tmpState.data.topic || tmpState.data.title || '', true);
          return scored.slice(0, 25);
        } catch (err) {
          console.warn('titlesTask failed', err);
          return [] as any[];
        }
      })();

      // Task D: Use Gemini urlContext to extract keywords directly from discovered URLs
      const urlContextTask = (async () => {
        if (!apiKey) return [] as any[];
        try {
          // Search web for urls (use normalized query if present otherwise topic)
          const searchQuery = (tmpState.conversationContext && tmpState.conversationContext.normalizeQueries && tmpState.conversationContext.normalizeQueries[0]) || tmpState.data.topic || tmpState.data.title || '';
          if (!searchQuery) return [] as any[];
          const webUrls = await geminiService.searchWebForUrls(searchQuery, apiKey);
          if (!webUrls || webUrls.length === 0) return [] as any[];
          aggregatedTrace.push({ step: 'fallback.urlContext.search', info: { count: webUrls.length } });
          const extracted = await geminiService.extractKeywordsFromUrls(webUrls, tmpState.data.topic || tmpState.data.title || '', apiKey);
          aggregatedToolOutputs.push({ type: 'fallback.urlContext', urlCount: webUrls.length, extractedCount: (extracted || []).length });
          if (!extracted || extracted.length === 0) return [] as any[];
          const unique = keywordTool.dedupeMerge(extracted as any[]);
          const scored = keywordTool.scoreIdeas(unique, tmpState.data.topic || tmpState.data.title || '', true);
          return scored.slice(0, 25);
        } catch (err) {
          console.warn('urlContextTask failed', err);
          return [] as any[];
        }
      })();

      // Task E: LLM-assisted fallback (ask Gemini to propose keywords)
      const llmTask = (async () => {
        if (!apiKey) return [] as any[];
        try {
          const llmSuggested = await geminiService.filterKeywordsWithFeedback([], tmpState.data.topic || tmpState.data.title || '', '', apiKey);
          if (!llmSuggested || llmSuggested.length === 0) return [] as any[];
          const mapped = llmSuggested.map((k: any) => ({ ...k, score: (k.score ?? 0.5) }));
          aggregatedToolOutputs.push({ type: 'fallback.llmSuggestions', count: mapped.length });
          aggregatedTrace.push({ step: 'fallback.llm', info: { count: mapped.length } });
          return mapped.slice(0, 25);
        } catch (err) {
          console.warn('llmTask failed', err);
          return [] as any[];
        }
      })();

      // Run all fallback tasks in parallel and collect results
      const all = await Promise.allSettled([variantTask, seedTask, titlesTask, urlContextTask, llmTask]);
      for (const a of all) {
        if (a.status === 'fulfilled' && Array.isArray(a.value) && a.value.length > 0) {
          candidateBuckets.push(a.value as any[]);
        }
      }

      // Merge buckets, dedupe, and final scoring
      const mergedAll = keywordTool.dedupeMerge(candidateBuckets.flat());
      if (mergedAll && mergedAll.length > 0) {
        const finalScored = keywordTool.scoreIdeas(mergedAll, tmpState.data.topic || tmpState.data.title || '', true).slice(0, 25);
        updates.halt = { reason: 'await_keyword_selection' } as any;
        (updates as any).keywordCandidates = finalScored;
        updates.currentStep = 'primary_keyword';
        (updates as any).toolOutputs = [...(updates as any).toolOutputs || [], ...aggregatedToolOutputs];
        (updates as any).trace = [...(updates as any).trace || [], ...aggregatedTrace];
        return updates;
      }
    }

    return updates;
  }

  async researchSecondary(blogData: Partial<AgentState['data']>, ctx?: Partial<AgentState>): Promise<Partial<AgentState>> {
    const tmpState: any = { data: blogData || {}, apiKey: this.apiKey, ...ctx };
    const res: any = await researchSecondaryNode(tmpState as AgentState);
    const updates: Partial<AgentState> = {};
    const dataUpdates = res.data || res.dataUpdates;
    if (dataUpdates) updates.data = { ...((tmpState.data as any) || {}), ...dataUpdates } as any;
    if (res.keywordCandidates) {
      updates.halt = { reason: 'await_secondary_selection' } as any;
      (updates as any).keywordCandidates = res.keywordCandidates;
      updates.currentStep = 'secondary_keywords';
    }
    if (res.toolOutputs) (updates as any).toolOutputs = res.toolOutputs;
    if (res.trace) (updates as any).trace = res.trace;
    if (res.messages) (updates as any).messages = res.messages;
    if (res.errorReason === 'no_keywords_found') {
      updates.halt = { reason: 'no_keywords_found' } as any;
    }
    return updates;
  }

  async generateTitles(stateLike: Partial<AgentState>): Promise<Partial<AgentState>> {
    const tmpState: any = { ...stateLike, apiKey: this.apiKey };
    const res: any = await titleGenerationNode(tmpState as AgentState);
    const updates: Partial<AgentState> = {};
    const dataUpdates = res.data || res.dataUpdates;
    if (dataUpdates) updates.data = { ...((tmpState.data as any) || {}), ...dataUpdates } as any;
    if (res.autoSelectedTitle) {
      updates.data = { ...(updates.data as any || {}), title: res.autoSelectedTitle } as any;
      updates.titleSelected = true;
      updates.halt = null;
      updates.currentStep = 'references';
    } else if (res.titleCandidates) {
      (updates as any).titleOptions = res.titleCandidates;
      updates.halt = { reason: 'await_title_selection' } as any;
      updates.currentStep = 'title';
    }
    if (res.toolOutputs) (updates as any).toolOutputs = res.toolOutputs;
    if (res.trace) (updates as any).trace = res.trace;
    return updates;
  }

  async generateOutline(stateLike: Partial<AgentState>): Promise<Partial<AgentState>> {
    const tmpState: any = { ...stateLike, apiKey: this.apiKey };
    const res: any = await discoveryNode(tmpState as AgentState);
    const updates: Partial<AgentState> = {};
    if (res.outline) updates.outline = res.outline;
    if (res.draft !== undefined) updates.draft = res.draft;
    updates.outlineApproved = false;
    if (res.needsApproval) {
      updates.halt = { reason: 'awaiting_approval' } as any;
      updates.currentStep = 'outline';
    }
    if (res.toolOutputs) (updates as any).toolOutputs = res.toolOutputs;
    if (res.trace) (updates as any).trace = res.trace;
    return updates;
  }

  async generateSection(stateLike: Partial<AgentState>): Promise<Partial<AgentState>> {
    const tmpState: any = { ...stateLike, apiKey: this.apiKey };
    const res: any = await proposalNode(tmpState as AgentState);
    const updates: Partial<AgentState> = {};
    if (res.draft !== undefined) updates.draft = res.draft;
    if (res.progress) updates.progress = res.progress;
    if (res.trace) (updates as any).trace = res.trace;
    return updates;
  }

  async finalizeBlog(stateLike: Partial<AgentState>): Promise<Partial<AgentState>> {
    const tmpState: any = { ...stateLike, apiKey: this.apiKey };
    const res: any = await finalBlogGenerationNode(tmpState as AgentState);
    const updates: Partial<AgentState> = {};
    if (res.draft !== undefined) updates.draft = res.draft;
    if (res.trace) (updates as any).trace = res.trace;
    return updates;
  }
}

export default UserAgent;
