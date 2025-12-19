## Current Status

- Crash observed: `generateIntentVariations` threw `TypeError: baseKeyword.trim is not a function` during `UserAgent.inferTopicMeanings`.
- Google Ads calls returned many raw keywords but the filtering pipeline reduced them to 0 top keywords for the "Pomelli" scenario.
- Gemini url-context schema bug (sending `urls`/`url` fields in tool config) was patched to enable url-context with `{ urlContext: {} }` and to embed URL lists in prompts with batched retries; this change is implemented but needs runtime verification.
- Web search / URL discovery in the current logs is performed by OpenAI + Google Custom Search (not Gemini).

## Short answer: which provider supplies URLs?

- URLs are coming from OpenAI (with Google Custom Search). The logs show: "Using OpenAI with Google Custom Search... Found X URLs". Gemini is used separately for url-context grounding, not for initial URL discovery.

## Decision: Option A vs Option B

- Option A (fix Gemini url-context usage) has been implemented in code and will be verified now. The plan: attempt runtime verification of the patched Gemini url-context flow (enable the tool with `{ urlContext: {} }`, embed URLs inside the prompt in small batches, and inspect returned `url_context_metadata`).
- If Option A fails at runtime (e.g., Gemini still cannot return useful url-context metadata or is rate-limited), switch to Option B: use OpenAI for url-context extraction or implement server-side HTML fetch + LLM extraction.

## Immediate Next Steps (priority)

1. Fix `generateIntentVariations` TypeError: add guards to ensure inputs are strings and add a unit test. File: `services/keywordService.ts`
2. Sanitize seeds before calling keyword helpers in `server/agent/userAgent.ts` (trim, String(), filter non-strings).
3. Run smoke tests for "Pomelli" and "AI":

```bash
pnpm -w build
npm run dev:full
```

4. Verify Gemini url-context runtime behavior: check `services/geminiService.ts` logs for `url_context_metadata` and successful responses for batched prompt-embedded URL requests.
5. Audit and relax keyword filtering/dedupe thresholds so brand/rare terms survive; consider tiered UI instead of hard cutoffs.
6. If Ads/title fallbacks still insufficient, implement server-side HTML fetch + LLM extraction fallback (fetch pages, extract text, LLM -> keywords).
7. Add unit & integration tests and CI coverage for the keyword pipeline, Ads API handling (mocks), and `generateIntentVariations` edge cases.

## Longer-term / Phases

- Phase A — Stabilize pipeline: input validation, seed sanitization, Gemini url-context verification, filter tuning.
- Phase B — Resilience: add HTML+LLM fallback, retry/backoff improvements for Google Ads, quota-aware exponential backoff.
- Phase C — UX and autosuggest: define auto-select policy, present tiered relevance to user, persist selections in history.
- Phase D — Tests/CI: add tests, mock external APIs, run smoke tests in PRs.

## Who should do what (suggested)

- Dev (me): implement the `generateIntentVariations` fix, add tests, run smoke tests, and verify Gemini logs.
- Dev (you): decide whether to run smoke tests now or have me run them; if smoke tests fail, approve switching to OpenAI url-context or implementing HTML+LLM fallback.

## Next action taken

- Action: "Option A" selected — I will verify Gemini url-context at runtime now by running the smoke tests and inspecting logs. If that fails, I'll fall back to OpenAI or HTML+LLM per the plan.

