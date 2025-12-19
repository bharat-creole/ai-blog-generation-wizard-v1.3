
## TODO (Later)

Next (optional) improvement: make secondary use the same LLM re-ranker as primary
Right now secondary is only algorithmically sorted (scoreIdeas), while primary additionally gets a Gemini “LLM reorder” step (your log shows 🔄 [LLM RANKING] Reordered keywords based on Gemini relevance.).

If you want the same quality for secondary ordering, wire in the same Gemini re-ranking step for secondary candidates too (only on the top N to control cost).
