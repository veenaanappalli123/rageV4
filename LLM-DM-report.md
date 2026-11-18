# LLM–DM Research, Integration Strategy, Results and Analysis

**EPITA — AI Systems Integration and Operations, BCS S5 (2026)**

## 1. Decision-model research

The *Decisions Decisions* course presentation (pp. 5–12) defines decision models as classifiers that answer typed `choice`, `noul` or `score` questions with probabilities, in contrast with LLMs which generate text. The following providers are listed in the course slides (availability/pricing are **not independently verified**):

| Candidate | Course-listed endpoint / status | Free hosted access confirmed? | Suitability |
|---|---|---|---|
| OpenAI Decisions API | `POST /v1/decisions`, public beta in slides | No | Typed decisions; needs account/API access |
| TypeSafe AI Jev | `POST /v1/systemone`, early access | No | Native DM; sign-up limitations noted |
| OpenRouter Jev | `/api/alpha/decisions` or `/api/v1/systemone`, input billed | No | Gateway option, pricing requires verification |
| vLLM Semantic Router Decision 3.0 | `POST /v1/systemone`, API key required | No | Candidate to investigate for free quota |
| Cloudflare Clef | Endpoint not confirmed in slides | No | Open weights, but hosted endpoint not established |
| Perplexity decider | Endpoint not confirmed in slides | No | Potential option, contract must be checked |

**Provider selection status:** A genuinely free hosted provider has **not yet been verified**. The application is provider-configurable rather than pretending a local keyword heuristic is a decision model. A suitable next candidate to investigate is vLLM Semantic Router's hosted Decision 3.0 service; this is a research priority, not a verified free-tier selection. The assignment explicitly allows contacting the instructor if a free DM cannot be found.

## 2. Integration strategy and justification

The user chooses among `demo`, `llm`, `dm`, and `dm+llm` on the frontend. The `dm` branch supplies support-ticket text as state and two closed-set `choice` questions for category and priority. A validator checks returned labels and probability bounds. The `llm` branch uses a chat-completions-style model to generate JSON category, priority, confidence and explanation. The `dm+llm` branch first gets fixed DM labels, then asks the LLM for an explanation while retaining DM labels. The `demo` branch is a local rule-based baseline only.

The DM can choose labels but cannot reliably write a support explanation; the LLM can explain but may produce invalid or inconsistent output. Using both combines typed classification with natural-language explanation, at the cost of additional latency and tokens. The architecture keeps the choice explicit and records model identifiers. The slide warns that confidence can be miscalibrated and typed output does not guarantee a correct decision (p. 15); low-confidence results should be reviewed by a human rather than acted on automatically.

## 3. Implementation and verification status

- Implemented in source: strategy selector; API adapters; Zod request/result validation; token usage; session chat history; dataset upload; random smoke runner; per-run logging; `/admin` view.
- Local deterministic demo: available without credentials, but **not evidence of DM performance**.
- Hosted LLM call: implemented, **not tested with a configured provider**.
- Hosted DM call: implemented against the slide's illustrative contract, **not tested against a real provider**; contract adjustments may be necessary.
- Original labelled 100-ticket and 500-ticket datasets: **not supplied**, so no real benchmark or comparison has been run.
- Triage V1/V2: interface supports both labels, but their behavior currently shares the same implementation pending earlier assignment details.

## 4. Results and analysis

**No empirical accuracy, latency or cost figures are claimed.** To complete the evaluation, import the professor's datasets, run comparable random samples for each configured strategy, and copy the actual run IDs/outputs from `/admin` here. Compare category and priority accuracy separately on labelled data; include error counts, latency, model names, input/output token usage, and actual/estimated costs with disclosed price assumptions. For fair comparison, keep the same sampled tickets across strategies (the current runner samples randomly per run; a fixed-seed/common-sample option would be a useful extension).

| Strategy | Sample | Category accuracy | Priority accuracy | Latency | Cost | Status |
|---|---:|---:|---:|---:|---:|---|
| LLM | — | — | — | — | — | Not run |
| DM | — | — | — | — | — | Not run |
| DM + LLM | — | — | — | — | — | Not run |

## 5. Risks and follow-up

Prompt injection in untrusted ticket text; calibration error; class imbalance; label mismatch with course data; hosted endpoint schema drift; API key leakage; unverified pricing; and evaluation bias from different random samples. Keep keys in `.env`, never in the repository. Treat outputs as support prioritization suggestions, not autonomous high-stakes actions.

**References:** EPITA Course 5, *LLM API Integration – Part III – Extra – Decisions Decisions*, pp. 5–12, 14–15 and 22–23; *LLM API Integration – Part III*, p. 2.
