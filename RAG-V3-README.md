# RAG V3 — Hybrid Search Architecture

**Course:** AI Systems Integration And Operations — BCS S5 — EPITA (2026)  
**Instructor:** Denis Amselem  
**Student:** Hetvi Fadadu (`hetvi.fadadu@epita.fr`)  
**Git Tag:** `v3`

---

## Overview

RAG V3 upgrades the baseline retrieval pipeline to **Hybrid Search** with Reciprocal Rank Fusion (RRF), integrating three complementary retrievers:
1. **Dense Semantic Retriever:** Embeddings-based similarity search (OpenAI-compatible embeddings endpoint, with deterministic local semantic projection fallback).
2. **BM25 Lexical Retriever:** Sparse term-frequency / inverse document frequency matching with saturation and length normalization.
3. **Concept Graph Retriever:** Provenance-aware entity-relation-entity knowledge graph for the Kestrel corpus, validated with Zod against a strict schema.
4. **Reciprocal Rank Fusion (RRF):** Fuses ranking lists with standard constant $k=60$ while preserving individual retriever ranks.

---

## 1. Installation & Running

```bash
# 1. Install dependencies
npm install

# 2. Run unit tests (13 tests verifying BM25, Dense, RRF, Graph, Zod schema)
npm test

# 3. Start RAG V3 Lab Web Application
npm run rag:v3
```

Open your browser to: **`http://localhost:3100`** (or `http://localhost:3100/rag`).

---

## 2. How to Switch Retrievers On and Off

### From the Web UI:
Under the **Retrievers & Fusion Controls (RRF)** section on `http://localhost:3100`:
- Check/uncheck **Dense** (Semantic Embeddings).
- Check/uncheck **BM25** (Lexical Search).
- Check/uncheck **Concept Graph** (Kestrel Reasoning).

When you ask a question:
- Each retrieved chunk displays badges showing **which retriever(s) retrieved it and at which rank** (e.g. `Dense #1`, `BM25 #3`, `Graph #2`).
- When the **Concept Graph** is switched on, the UI renders the **Reasoning Path Behind Answer**:
  - Entities detected in the query.
  - Edges traversed ($A \xrightarrow{\text{relation}} B$).
  - Originating chunk IDs and supporting quotes.

### From the Command Line / Evaluation Command:
Pass a comma-separated list to the `--retrievers=` flag:
```bash
# Dense alone
npm run rag:evaluate:v3 -- kestrel --retrievers=dense

# BM25 alone
npm run rag:evaluate:v3 -- kestrel --retrievers=bm25

# Concept Graph alone
npm run rag:evaluate:v3 -- kestrel --retrievers=graph

# Hybrid: Dense + BM25
npm run rag:evaluate:v3 -- kestrel --retrievers=dense,bm25

# Hybrid: Dense + BM25 + Concept Graph
npm run rag:evaluate:v3 -- kestrel --retrievers=dense,bm25,graph
```

---

## 3. How to Build the Concept Graph

To extract and build the Kestrel knowledge graph from all 45 corpus chunks:

```bash
npm run rag:graph -- kestrel
```

This command:
1. Parses each chunk and extracts `(subject, relation, object)` triples with exact textual quotes.
2. Validates every extraction strictly against the **Zod schema** (`extractionSchema.parse()`).
3. Performs Unicode-normalized entity resolution to unify references.
4. Writes the graph to `rag-graphs/kestrel.json` (34 entities, 29 relations).
5. Draws a random sample of 10 triples and outputs them to `rag-results/kestrel-triples-to-grade.json` for human quality auditing.

---

## 4. How to Run Benchmark Evaluations

Run the automated evaluation suite against both course corpora:

```bash
# Benchmark Kestrel corpus across all required configurations:
npm run rag:evaluate:v3 -- kestrel

# Benchmark Personal / Second corpus across configurations:
npm run rag:evaluate:v3 -- personal

# Optional: Add --generate to track LLM answer generation tokens and latency:
npm run rag:evaluate:v3 -- kestrel --generate
```

The script evaluates:
- **HitRate@k** and **Recall@k** for $k \in \{1, 3, 5, 10\}$.
- Overall metrics and breakdown per question type:
  - `exact_identifier`
  - `split_answer`
  - `vocabulary`
  - `versions`
  - `two_hop` (measures whether *both* hops were successfully retrieved).
- Excludes unanswerable questions (`not_in_corpus`) from retrieval statistics and evaluates them separately under correct abstention.
- Automatically saves detailed evaluation JSON reports under `rag-results/v3-<corpus>-<timestamp>.json`.

---

## 5. Hidden Route Requirement

As requested in the V3 specification (Slide 5):
- Route: **`GET /bm25`**
- It is intentionally **not linked or referenced** from anywhere in the UI or navigation.
- Navigating directly to `http://localhost:3100/bm25` displays the required prompt in bold 56px font:
  > **Watch your sources!**

---

## 6. Deliverables & Submission Checklist

- [x] **Updated Question Sets:** `rag-data/kestrel/questions.jsonl` contains preserved V2 questions plus 2 new `two_hop` questions (`q11`, `q12`), each with exact evidence quotes for both hops.
- [x] **Extraction Quality Grades:** `rag-results/kestrel-triples-to-grade.json` contains 10 audited triples graded as `correct`, `wrong`, or `unsupported` (7 / 2 / 1 breakdown).
- [x] **README.md & RAG-V3-README.md:** Complete usage guide for toggling retrievers, graph indexing, and benchmarking.
- [x] **REPORT.md:** Comprehensive experimental results matrix, default configuration justification, BM25 & graph design decisions, RRF fusion analysis, and known failure modes.
- [x] **Hidden `/bm25` Page:** Accessible at `/bm25` showing `"Watch your sources!"`.
- [x] **Git Tag:** Tagged as `v3`.
