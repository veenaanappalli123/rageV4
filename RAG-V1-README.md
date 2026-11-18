# RAG V1 — Naive baseline

V1 is the simplest end-to-end RAG application in this repository. It indexes the selected `.md` and `.txt` corpus, splits documents into configurable chunks, retrieves the top-k passages with one dense retriever, and can send those passages to the configured chat model for a grounded answer with chunk citations.

## Run

```bash
npm install
npm run rag:v1
```

Open `http://localhost:3100`. Choose `kestrel` or `personal`, enter a question, adjust chunk size / overlap / top-k, and select answer generation if an LLM provider is configured.

## Configuration

Copy `.env.example` to `.env` and set:

- `RAG_EMBEDDINGS_API_URL`
- `RAG_EMBEDDINGS_API_KEY`
- `RAG_EMBEDDINGS_MODEL`
- `RAG_API_URL`, `RAG_API_KEY`, and `RAG_MODEL` for generated answers

The dense retriever currently uses the configured OpenAI-compatible embeddings endpoint when available. If it is not configured or fails, the shared implementation falls back to a deterministic local hashed-vector projection. That fallback is useful for offline demonstrations but is **not a trained semantic embedding model** and should not be reported as equivalent to one.

## V1 scope

- `.md` and `.txt` corpus indexing
- configurable chunk size and overlap
- top-k dense retrieval
- displayed source passages and chunk IDs
- optional schema-checked grounded answer generation
- controlled error responses when configuration or requests fail

V1 intentionally does not use BM25, concept graphs, or reciprocal-rank fusion. Those are later-version additions.
