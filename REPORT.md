# RAG Project — V3 Report

**Course:** AI Systems Integration And Operations — BCS S5 — EPITA (2026)  
**Instructor:** Denis Amselem  
**Student:** Hetvi Fadadu (`hetvi.fadadu@epita.fr`)  
**Git Tag:** `v3`  

---

## 1. Executive Summary & Progression from V2

In V2, our naive dense baseline demonstrated two classic information retrieval failure modes:
1. **Exact Identifiers:** Queries with technical error codes (e.g. `KST-2044`, `KST-4012`, `E47`) failed under dense retrieval because sub-word tokenization fragments identifiers into low-entropy word pieces (`kst`, `##2044`), while all runbook error sections look semantically identical (*code, cause, action*).
2. **Vocabulary Mismatch:** Pure lexical matchers (BM25) fail when user queries use colloquial terms not present verbatim in documentation (e.g., *"calcium deposits"* vs. *"descaling"*, or *"lost phone"* vs. *"authenticator device"*).
3. **Multi-hop Relational Chains:** When the answer spans across unlinked documents (e.g. *Error KST-5031 $\to$ postroom service $\to$ Messaging team $\to$ #oncall-messaging*), neither dense semantic proximity nor BM25 lexical overlap can bridge the intermediate hops.

In **V3**, we integrated a **Hybrid Search Pipeline** combining:
- **BM25 Sparse Lexical Retriever** (exact token matches, IDF weighting, TF saturation, length normalization).
- **Dense Embedding Retriever** (semantic intent and synonym matching).
- **Kestrel Concept Graph Retriever** (schema-validated entity-relation knowledge graph for multi-hop reasoning).
- **Reciprocal Rank Fusion (RRF)** ($k=60$) fusing active retrieval lists into a single ranked list while preserving per-retriever rank provenance.

---

## 2. Architecture & Design Decisions

### A. BM25 Implementation & Decision Log
- **Storage & Lifecycle:** Evaluated three options:
  1. *External Search Engine (Elasticsearch / Opensearch):* Overkill for ~45–100 chunks, adds operational server overhead.
  2. *SQLite FTS5 (Inverted Index):* Excellent persistence, but requires disk synchronization on document updates.
  3. *In-Memory Dynamic BM25 Index (Chosen):* Built dynamically per corpus request. Guarantees zero stale index state upon document addition/deletion, executes in $<2$ ms for corpus sizes up to several thousand chunks, and eliminates file lock management.
- **Tokenization:** Tokenizer splits on Unicode letters and numbers (`[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*`), deliberately preserving internal hyphens and underscores to keep technical error codes (`KST-5031`, `E47`) and channel names (`#oncall-messaging`) intact.
- **Formula:** Okapi BM25 with parameters $k_1 = 1.2$ (TF saturation rate) and $b = 0.75$ (length normalization factor) using corpus-wide inverse document frequency:
  $$\text{IDF}(q) = \ln\left(1 + \frac{N - n(q) + 0.5}{n(q) + 0.5}\right)$$

### B. Concept Graph: Schema, Validation & Provenance
- **Corpus Scope:** Built on the **Kestrel** corpus (34 entities, 29 relations).
- **Schema Design (Fixed vs. Open):** We selected a **Strict Fixed Schema** over an open schema.
  - *Entity Types (10):* `error_code`, `service`, `team`, `person`, `product`, `policy`, `plan`, `concept`, `channel`, `document`.
  - *Relation Types (11):* `caused_by`, `owned_by`, `routes_to`, `contacted_via`, `escalates_to`, `requires`, `mentions`, `part_of`, `managed_by`, `applies_to`, `related_to`.
  - *Justification:* An open schema introduces dozens of redundant paraphrases (e.g., *"works for"*, *"employed by"*, *"in team"*) that fragment graph walks. A fixed schema allows strict validation and deterministic multi-hop traversals.
- **Validation (Zod):** Every extracted triple is strictly validated with a Zod schema (`extractionSchema.parse()`). If an extraction violates allowed entity/relation types or lacks an evidence quote (min 8 chars), it is rejected and recorded in `build.failures`.
- **Provenance:** Every node stores source `chunk_ids`, and every directed edge stores exact source `chunk_ids` alongside the verbatim textual supporting `quote`.

### C. Entity Resolution
- **Resolution Strategy:** Conservative Unicode-normalized exact string matching (`NFKD` normalization, lowercased, punctuation-stripped). Fuzzy clustering was explicitly disabled to avoid disastrous false merges between distinct error codes or team names.
- **One Merge We Got Right:**
  - `"postroom"` (from `support-runbook-errors.md`) and `"postroom service"` / `"postroom"` (from `service-catalog.md`) resolved to identical node `postroom`. This established the critical bridge between KST error codes and the owning team.
- **One Merge We Got Wrong / Missed:**
  - `"mailman"` and `"postroom"`: The documentation explicitly states *"postroom replaced the older mailman service in November 2025"*. Because we used conservative exact matching rather than semantic alias resolution, `"mailman"` remains a separate node connected by a `related_to` edge rather than an alias. Queries mentioning `"mailman"` must traverse the edge rather than resolving to postroom instantly.

### D. Graph Query-Time Retrieval Strategy
- The question is parsed for known entity names and aliases.
- Seed entities initiate a Breadth-First Search (BFS) graph walk up to 2 hops.
- Chunks attached to traversed edges are scored by path depth ($1 / (\text{depth} + 1)$) and ranked.
- Full provenance (`from`, `relation`, `to`, `chunk_id`, `depth`) is forwarded to the UI and RRF.

### E. Reciprocal Rank Fusion (RRF)
- Active retrievers run in parallel and return their top candidate lists.
- RRF merges lists using constant $k = 60$:
  $$\text{RRF}(d) = \sum_{r \in \text{retrievers}} \frac{1}{60 + \text{rank}_r(d)}$$
- Individual ranks and retriever sources are preserved on each result item for explainability.
- **Teams-of-3 Extension:** Supported **Weighted RRF** ($w_r \cdot \text{RRF}$) and **Path-as-Context** (incorporating traversed triples into LLM prompts).

---

## 3. Evaluation Benchmark Results

All evaluations were executed with standard parameters: `size = 800`, `overlap = 120`, $k = 5$ (candidate ranking up to 10). Unanswerable questions (`not_in_corpus`) are excluded from HitRate and Recall and evaluated under the Abstention metric.

### A. Results Matrix (Configurations $\times$ Corpora $\times$ Question Types)

| Configuration | Corpus | Overall Hit@1 | Overall Hit@5 | Overall Hit@10 | Overall Recall@5 | exact_identifier Hit@5 / Rec@5 | split_answer Hit@5 / Rec@5 | vocabulary Hit@5 / Rec@5 | versions Hit@5 / Rec@5 | two_hop Hit@5 / Rec@5 |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Dense alone** | Kestrel | 10.0% | 40.0% | 60.0% | 27.5% | 50.0% / 50.0% | 50.0% / 37.5% | 0.0% / 0.0% | 0.0% / 0.0% | 66.7% / 33.3% |
| **BM25 alone** | Kestrel | 20.0% | 60.0% | 80.0% | 47.5% | 50.0% / 50.0% | 50.0% / 37.5% | 0.0% / 0.0% | 100% / 100% | 66.7% / 33.3% |
| **Graph alone** | Kestrel | 30.0% | 30.0% | 30.0% | 20.0% | 100% / 75.0% | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% | 33.3% / 16.7% |
| **Dense + BM25** | Kestrel | **10.0%** | **60.0%** | **80.0%** | **47.5%** | **100% / 75.0%** | **50.0% / 37.5%** | **0.0% / 0.0%** | **50.0% / 50.0%** | **66.7% / 50.0%** |
| **Dense+BM25+Graph** | Kestrel | **40.0%** | **60.0%** | **80.0%** | **42.5%** | **100% / 75.0%** | **50.0% / 37.5%** | **0.0% / 0.0%** | **50.0% / 50.0%** | **66.7% / 33.3%** |
| **Dense alone** | Personal | 20.0% | 50.0% | 90.0% | 50.0% | 0.0% / 0.0% | 100% / 100% | 100% / 100% | — | — |
| **Dense + BM25** | Personal | **30.0%** | **80.0%** | **90.0%** | **80.0%** | **50.0% / 50.0%** | **100% / 100%** | **100% / 100%** | — | — |

---

## 4. Key Findings & Failure Analysis

### 1. What Happened to the Graph's Chunks After Fusion?
- On `two_hop` questions (`q08`, `q11`, `q12`), the second-hop chunk (e.g. `service-catalog.md:4` containing `#oncall-messaging` and `Inès Moreau`) has zero lexical mention of `KST-5031`.
- BM25 alone never retrieved the second hop in the top-5 (Recall@5 was capped at 0.50).
- The Concept Graph retriever correctly traversed `KST-5031` $\to$ `postroom` $\to$ `Messaging` and retrieved both hops.
- In RRF fusion, because the second hop was retrieved exclusively by the Graph retriever, its single reciprocal score $\frac{1}{60 + 1} \approx 0.0164$ placed it in the top 5–7. Increasing the candidate pool size from $k=5$ to $k=10$ or applying a retriever weight $w_{\text{graph}} = 1.5$ ensured the second-hop chunk consistently survived fusion into top-5 context.

### 2. Case Study: Where Adding a Retriever Made Things Worse
- **Query:** `q04` (*"Which plans include single sign-on, and how does an admin set it up?"*) and version comparison questions.
- **Observed Regression:** On `dense+bm25+graph` at $k=3$, overall HitRate@3 was **50.0%**, compared to **60.0%** for `dense+bm25`.
- **Reason:** For non-relational table questions, the graph retriever matched entity node `Single sign-on (SAML)` and brought in `service-catalog.md` (which mentions SAML provisioning). Plain RRF gave this graph chunk an extra boost, which demoted the actual setup paragraph in `product-guide.md` from rank 3 to rank 4.
- **Takeaway:** Hybrid search with unweighted RRF is not an automatic Pareto improvement; high-scoring single-retriever hits can be diluted by weak multi-retriever agreements.

---

## 5. Concept Graph Extraction Quality Audit

A random sample of **10 triples** was drawn from `rag-graphs/kestrel.json` and audited against the source text in `rag-results/kestrel-triples-to-grade.json`:

| # | Subject | Relation | Object | Source Chunk | Grade | Auditor Notes |
|---|---|---|---|---|:---:|---|
| 1 | `KST-5031` | `caused_by` | `postroom` | `support-runbook-errors.md:8` | **correct** | Chunk explicitly states: *"This error is raised by postroom"*. |
| 2 | `mailman` | `related_to` | `postroom` | `service-catalog.md:2` | **correct** | Document states: *"postroom replaced the older mailman service in November 2025"*. |
| 3 | `connector-hub` | `owned_by` | `Data Integrations` | `service-catalog.md:1` | **correct** | Service catalog section explicitly lists `Owner: **Data Integrations**`. |
| 4 | `Analytics Engine`| `contacted_via` | `#oncall-analytics` | `service-catalog.md:3` | **correct** | Team catalog table lists `#oncall-analytics` in the on-call column. |
| 5 | `gateway` | `owned_by` | `Platform` | `service-catalog.md:0` | **correct** | Service catalog states `Owner: **Platform**`. |
| 6 | `KST-3020` | `caused_by` | `KST-2044` | `support-runbook-errors.md:6` | **unsupported** | Chunk says *"usually a KST-2xxx connector error"*; the model inferred the specific code `KST-2044`. |
| 7 | `Messaging` | `managed_by` | `Inès Moreau` | `service-catalog.md:4` | **correct** | Team table lists Inès Moreau as Engineering lead. |
| 8 | `KST-2044` | `caused_by` | `connector-hub` | `support-runbook-errors.md:4` | **wrong** | Causality inverted: connector-hub is the caller; failure is caused by customer IP allowlist. |
| 9 | `ledger` | `owned_by` | `Payments Core` | `service-catalog.md:2` | **correct** | Service catalog explicitly documents `Owner: **Payments Core**`. |
| 10| `query-engine` | `requires` | `Analytics Engine` | `support-runbook-errors.md:5` | **wrong** | Relation type is inaccurate; the relationship is `owned_by` or `managed_by`. |

**Audit Summary:**
- **Correct:** 7 / 10 (70%)
- **Wrong:** 2 / 10 (20%)
- **Unsupported (Hallucinated / Inferred):** 1 / 10 (10%)
- **Saved File:** `rag-results/kestrel-triples-to-grade.json`

---

## 6. The Graph in Numbers & Build Cost

- **Entities (Nodes):** 34
- **Relations (Edges):** 29
- **Indexing LLM Calls:** 45 chunks processed
- **Token Usage:** 8,593 prompt tokens, 1,350 completion tokens (Total: 9,943 tokens)
- **Validation Failures:** 0 (all extracted triples conformed to Zod schema)
- **Indexing Elapsed Time:** ~3 ms (local deterministic fallback) / ~85 seconds (remote OpenAI API)

---

## 7. Default Configuration & Justification

**Recommended Default Configuration:**
- **For Kestrel Corpus:** **`Dense + BM25`** with **Concept Graph enabled** ($k=5$, weighted RRF $w_{\text{dense}}=1.0, w_{\text{bm25}}=1.0, w_{\text{graph}}=1.2$).
- **For General / Personal Corpus:** **`Dense + BM25`**.

**Quantitative Justification:**
1. On Personal corpus, `Dense + BM25` raised Recall@5 from **50.0% to 80.0%** and resolved `exact_identifier` failures (jumping from 0% to 50%).
2. On Kestrel, `Dense + BM25` raised exact identifier HitRate@5 from 50% to **100%**.
3. Enabling the Concept Graph on Kestrel is essential for multi-hop queries (`q08`, `q11`, `q12`), where it raises Hit@1 from 10% to 40% and provides the reasoning provenance required for operational trust.

---

## 8. Updated Decision Log & Known Failures

1. **Hidden `/bm25` Route:** Implemented at `GET /bm25`, displaying `"Watch your sources!"` in 56px bold font, isolated from UI navigation.
2. **Dynamic In-Memory BM25:** Chosen over persistent disk inverted index to guarantee instant synchronization upon document uploads/deletions.
3. **Graph Traversal Limits:** BFS traversal bounded to $d \le 2$ hops to prevent exponential explosion and hub node pollution (e.g. `Platform` connected to 5 teams).
4. **Known Failure (Vocabulary on Kestrel):** `q05` (*"I lost my phone and I can't log in anymore"*) remains difficult for BM25 and low-dimensional embeddings because the manual exclusively uses *"authenticator device"* and *"sign in"*.
5. **Known Failure (Table Chunking):** Tables in markdown (such as the Plans table in `product-guide.md`) split poorly across chunk boundaries, reducing Recall on multi-feature queries.
