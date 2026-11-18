# EPITA Support Ticket Triage App

Course 5 integrated project: chat history, triage V1/V2 UI, Zod validation, token usage, decision model strategy selection, smoke tests and admin logging.

## Quick start

Requires Node.js 18+ and npm.

```sh
npm install
cp .env.example .env  # On Windows, copy .env.example .env
npm test
npm start
```

Open http://localhost:3000 (admin at http://localhost:3000/admin).

**Default strategy `demo` uses local keyword rules, NOT an AI model.** It allows interface and test-runner demonstrations without credentials. The real LLM/DM strategies require configured, accessible hosted providers. Do not submit demo output as evidence of decision-model performance.

## Hosted AI configuration

Fill `.env` (do not share this file). `LLM_API_URL` must be a **full chat-completions-compatible URL** (e.g. a provider's `/v1/chat/completions` endpoint), and `LLM_MODEL` must be an authorized model name. `DM_API_URL` must be a **full hosted decision-model endpoint**, with `DM_MODEL` and `DM_API_KEY` from that provider. The DM adapter sends `{model,state,questions}` with `choice` criteria and expects a JSON response containing category and priority objects with `choice` and `probabilities` (optionally nested under `decisions` or `results`). **Provider schemas differ; check and adapt to the chosen provider's actual documentation.** The slide examples are not proof that any given provider will accept this exact contract.

Optional `.env` prices: `LLM_INPUT_USD_PER_MILLION` and `DM_INPUT_USD_PER_MILLION` to estimate input-token cost. No cost is fabricated when a price is unknown. DM+LLM price is not fully estimated by the generic calculator.

## UI and API

- `POST /api/triage` — `{text, strategy: "demo"|"llm"|"dm"|"dm+llm", version: "v1"|"v2"}`. Version selector is included for course navigation; both currently use the same validated classification implementation. **Distinct original V1 behavior still needs the earlier course specification.**
- `POST /api/chat` — `{message, conversationId?, strategy}`. LLM chat sends the full recent conversation history; demo gives a deterministic response. Chat sessions are kept in server memory and lost on restart.
- `POST /api/datasets/100` or `/api/datasets/500` — upload JSON array of tickets from UI. These are kept in server memory until restart. Alternatively place `data/tickets-100.json` and `data/tickets-500.json` on disk.
- `POST /api/smoke` — `{dataset:"100"|"500", count:1..100, strategy}`. Random sampling without replacement, per-ticket predictions, category and priority mismatches, accuracy on valid labelled rows, latency, token usage, and model tracking.
- `GET /api/admin` — log JSON, `GET /admin` — admin view, `GET /api/config` — provider readiness.

## Dataset shape

```json
[
  {"text":"My invoice shows an incorrect charge", "category":"billing", "priority":"low"},
  {"text":"Production API down for all customers", "category":"technical", "priority":"critical"}
]
```

Categories: `account`, `billing`, `technical`, `access`, `other`. Priorities: `low`, `medium`, `high`, `critical`. **The course datasets are not included.** They must be supplied and mapped to this label taxonomy. The 500-ticket set can omit labels. If the course uses different labels, adjust the taxonomy and adapters before evaluating.

## Validation and limitations

Run `npm test`. This project has a usable UI and testable API, but is **not validated against a live hosted decision model**, and no authentic 100/500 course datasets or live benchmark results were provided. Smoke testing is sequential and may take time for paid models. Log files in `data/runs.jsonl` are local and the admin page is not authenticated (use on localhost only). No persistence for chat beyond the current server process. For a production deployment add auth, durable storage, rate limiting, audit controls, and human review for consequential decisions.

See `LLM-DM-report.md` for the research and evaluation plan.
