# RAG V2 extension

This adds a separate RAG app alongside the existing support-triage application.

## Setup
`npm install`

Run the original triage app with `npm start` or the RAG app with `npm run rag:v2`, then open `http://localhost:3100`.

## Data
The five authentic Kestrel documents and all 10 supplied starter questions are included in `rag-data/kestrel/`.
The second corpus uses three documents from this support-triage project in `rag-data/personal/docs/`, with 11 original questions in `rag-data/personal/questions.jsonl`.
Both corpora are included so the retrieval evaluation can run offline.

## Web features
The Ask tab retrieves source chunks and optionally generates a cited answer. Documents tab adds/deletes documents and imports a JSONL question set. Evaluation tab saves a run under `rag-results/`. Words tab shows vocabulary frequency, number of chunks containing each word, and question words with their matching chunks.

## Repeatable CLI evaluation
`npm run rag:evaluate -- kestrel --sizes 500,800 --overlaps 80,120`
`npm run rag:evaluate -- personal --sizes 500,800 --overlaps 80,120`

Add `--generate` to call the LLM for each retrieved question, or `--no-context` to test the model without retrieval. These options need `RAG_API_KEY`, `RAG_API_URL` (OpenAI-compatible chat-completions endpoint), and `RAG_MODEL` set in your environment. Without them, retrieval-only evaluation still works. Each run produces JSON with per-question retrieved chunks, HitRate@k, Recall@k, per-type results, and blank manual grade fields. The comparison file lists all configurations.

**Metric caveat:** Evidence is matched by source filename and exact quote inside a chunk. If a quote spans a chunk boundary, it may not match; adjust the quote or chunking before interpreting metrics. Questions without matching evidence are flagged and excluded from retrieval metric denominators.

## Testing
`npm test`

## Submission checklist
- [x] Import the authentic Kestrel corpus and starter questions
- [x] Add a second corpus and 10+ original questions
- [ ] Run no-context baseline on both sets and review already-answerable questions
- [x] Run and compare at least two configurations for both corpora
- [ ] Generate answers and manually grade the best configuration
- [x] Diagnose one retrieval miss per corpus using Words Analytics
- [ ] Complete REPORT.md with your own real observations
- [ ] Commit the project and create Git tag `v2`

The unlinked `/about` page is intentionally available only by entering its URL directly. **Retrieval-only evaluation is verified. Hosted LLM no-context tests, manual grading, and personal report review are still outstanding.**
