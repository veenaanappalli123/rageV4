# RAG V4 — Query Expansion, Reranking & Grounded Answers

RAG V4 extends the V3 hybrid retrieval stack. It keeps V3 intact and adds a second-stage retrieval pipeline designed to improve recall, ordering, and answer reliability.

## What's new

1. **Query expansion:** preserves the original query and adds a small set of deterministic domain-neutral alternatives (for example, login/sign-in and timeout/latency). It requires no LLM call.
2. **Hybrid candidate retrieval:** runs the existing dense, BM25 and optional concept-graph retrievers for each query variant, then fuses their ranked lists.
3. **Local second-stage reranking:** scores lexical coverage, exact phrase/identifier matches, first-stage fusion score, and graph provenance. A diversity penalty reduces repeated chunks from the same source. The score and feature breakdown are returned for inspection.
4. **Confidence-aware abstention:** compares the top rerank score with a configurable threshold. If generation is requested and evidence is below threshold, V4 abstains rather than asking the LLM to invent an answer.
5. **Citation validation:** generated citation IDs are restricted to retrieved chunk IDs; unsupported IDs are reported separately.
6. **V4 UI and benchmark:** a dedicated interface and evaluation command are provided.

The reranker is a transparent heuristic, not a trained cross-encoder. Query expansion is rule-based, not an LLM rewrite. Scores are ranking signals, not calibrated probabilities.

## Run

```bash
npm install
npm test
npm run rag:v4
```

Open `http://localhost:3100/rag-v4`. V4 uses the same `RAG_PORT` as the other RAG servers, so stop V1/V2/V3 before starting it.

## API

`POST /api/rag/v4/ask`

```json
{
  "corpus": "kestrel",
  "question": "What does KST-5031 mean?",
  "dense": true,
  "bm25": true,
  "graph": false,
  "expand": true,
  "candidate_k": 15,
  "k": 5,
  "diversity": 0.12,
  "threshold": 0.16,
  "generate": false
}
```

Response includes query variants, ranked evidence with rerank feature values, confidence assessment, and (when requested) an answer with validated citations. Set `generate: true` only after configuring `LLM_URL`, `LLM_API_KEY`, and `LLM_MODEL` in `.env`. Never commit `.env`.

`GET /api/rag/v4/health` reports the V4 feature set.

## Evaluation

```bash
npm run rag:evaluate:v4 -- kestrel
npm run rag:evaluate:v4 -- personal
npm run rag:evaluate:v4 -- kestrel --graph
```

The evaluation writes `rag-results/v4-<corpus>-<timestamp>.json` and reports HitRate@k and Recall@k. It uses the same evidence-ground-truth conventions as V3. Dense retrieval uses the configured embeddings provider when available and otherwise the existing deterministic local fallback. Do not present fallback results as model-embedding results.

## Limitations / validation

- The query-expansion synonym list is deliberately small and should be adapted to the course domain.
- The reranker is heuristic; benchmark it against V3 and, if permitted, a trained cross-encoder before claiming an improvement.
- The confidence threshold is not calibrated and must be tuned on held-out questions.
- Citation validation verifies that IDs belong to retrieved chunks; it does not prove every sentence is entailed by those chunks. Human review remains necessary.
- The concept graph is optional and currently available only for corpora with a built graph.
