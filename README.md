# Gold Loan Portal, with an AI Agent

A full-stack gold-loan intake portal built for the TGlobal Full-Stack Developer take-home assignment.

- **Apply** on one scrollable page: your gold → live quote for both plans → review every figure → submit.
- **Track** an application again at any time with its ID and your mobile number.
- **Admin** sees every application, moves it through the status workflow, and opens any application in full with its history.
- **Loan Assist** chat does the same job by conversation. It calls the same backend tools as the form, never does maths itself, and files nothing until you press Confirm.

> This project was built with heavy use of an AI coding assistant (Claude Code). What it wrote, where it was wrong, and how that was caught is in [AI_LOG.md](AI_LOG.md). Design write-ups: [ARCHITECTURE.md](ARCHITECTURE.md) · [docs/AGENT_DESIGN.md](docs/AGENT_DESIGN.md) · [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md)

---

## Quick start

You need **Node 22 or newer**. Docker Desktop is only needed for PostgreSQL.

```bash
npm install
npm run dev          # http://localhost:5173 (API on :4000) – works immediately, no database or key needed
npm test             # unit + API tests
npm run eval         # the agent's 16 test conversations
```

That's the whole setup. With no configuration the data is kept in memory (lost on restart) and Loan Assist runs the built-in offline assistant.

### With PostgreSQL (one command)

Start Docker Desktop, then:

```bash
npm run dev:pg       # starts PostgreSQL 16 in Docker, runs migrations + seed, starts the app on it
npm run test:pg      # every test, including the ones that run against real PostgreSQL
```

To make plain `npm run dev` use PostgreSQL too: `npm run db:up` once, `cp .env.example .env`, and uncomment `DATABASE_URL`. `npm run db:migrate` / `npm run db:seed` exist if you want to run them by hand (both are idempotent). `npm run db:down` stops the container.

### With an AI model

`cp .env.example .env` (if you don't have one yet), then set **one** of these in `.env` and restart:

```bash
# Google Gemini – free tier, the model this project was tested with (key: aistudio.google.com/apikey, no card)
OPENAI_API_KEY=your-gemini-key
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
OPENAI_MODEL=gemini-3.5-flash-lite

# or Anthropic Claude – paid, billed per use at console.anthropic.com (separate from a Claude Pro subscription)
ANTHROPIC_API_KEY=sk-ant-...
```

The `OPENAI_*` names describe the **request format**, not the company: Google offers Gemini through an OpenAI-compatible address, so with the lines above every request goes to Google with your Gemini key, and OpenAI is never contacted. If both keys are set, Claude is used.

The sidebar footer, the chat header and the **About** page all show which assistant is running (for example `gemini-3.5-flash-lite`, `claude-opus-5-5`, or "offline assistant (no key)").

### Everything in Docker

```bash
docker compose up --build       # app + PostgreSQL on http://localhost:4000
```

The API serves the built React app, so this is one app container plus the database.

### Deploying, and where the data lives

| How it runs | Where applications are stored | After a restart or redeploy |
| --- | --- | --- |
| `npm run dev` with no `DATABASE_URL` | In memory | **Gone.** Fine for a demo, never for real use |
| `npm run dev:pg` or `docker compose up` on your machine | PostgreSQL in Docker, on the named volume `pgdata` | **Kept.** It survives restarts, rebuilds and `docker compose down`. Only `docker compose down -v` deletes the volume |
| A hosting service (Render, Railway, Fly.io, a VM…) | A managed PostgreSQL (Neon, Supabase, Render Postgres, RDS…) set as `DATABASE_URL` | **Kept.** The database lives outside the app container |

To deploy, build the `Dockerfile` on any host that runs Docker and set two secrets in the host's settings (never in the repo): `DATABASE_URL` (from the managed PostgreSQL, usually ending in `?sslmode=require`) and `ANTHROPIC_API_KEY`. On every start the app applies any new migrations and re-runs the seed. Both only add or update; neither ever deletes data, so redeploying keeps every application. Not yet tried against a managed PostgreSQL provider; tested with PostgreSQL 16 in Docker.

---

## What was used

| Part | What | Notes |
| --- | --- | --- |
| Runtime | Node.js 22+, TypeScript, npm workspaces | `packages/shared`, `apps/api`, `apps/web` |
| API | Express 4, Zod, helmet, compression, pino | Same Zod schemas validate REST requests and AI tool arguments |
| Database | **PostgreSQL 16** through `pg` with plain SQL migrations (`001_init.sql`, `002_lead_plan_terms.sql`) and a seed script | Not Prisma/Drizzle/Knex: plain SQL was chosen for the advisory lock and the `CHECK` constraints. In-memory storage is used when no `DATABASE_URL` is set |
| Web | React 18 + Vite, plain CSS (no UI library) | Gold & white (light, default) and gold & black (dark) themes |
| Fonts | DM Sans, Playfair Display | Self-hosted through Fontsource (no Google Fonts requests) |
| Images | 3 public-domain (CC0) gold photos | See [Credits](#credits) |
| AI model used | **Google Gemini 3.5 Flash-Lite** (`gemini-3.5-flash-lite`), free tier, through Google's OpenAI-compatible endpoint | What the live tests ran on. Needs a free key from aistudio.google.com |
| Also supported | **Claude Opus 5.5** (`claude-opus-5-5`) through the official `@anthropic-ai/sdk`; any other OpenAI-compatible API (OpenAI, Groq, Ollama) | Claude needs a paid key. It is unit-tested but has not made a live call yet |
| Without a key | The built-in rule-based assistant (not an AI model) | Used by `npm test` and `npm run eval`, and as the automatic fallback |
| Tests | `node:test` + `assert`, an eval runner (`npm run eval`) | No test framework dependency |
| Ops | Dockerfile, docker-compose, GitHub Actions CI | CI runs typecheck, tests (with a Postgres service), evals and the build |
| Building it | Claude Code (AI coding assistant) | See [AI_LOG.md](AI_LOG.md) |

---

## How the AI assistant (Loan Assist) works

```
browser chat ──POST /api/v1/chat──▶ AgentOrchestrator (server)
                                       │  1. InputGuard: blocks prompt injection / off-limits input
                                       │  2. asks the model what to do next ──▶ Claude Opus 5.5 (Anthropic API)
                                       │                                       or the offline assistant
                                       │  3. runs the tool the model chose:
                                       │        get_loan_schemes()          → the plans in the database
                                       │        calculate_quote(...)        → the same QuoteService as POST /quotes
                                       │        check_existing_application() → 7-day duplicate check
                                       │        submit_application(...)     → only PREPARES a summary card
                                       │  4. GroundingGuard: every ₹, gram, % and id in the reply must come
                                       │     from a tool result or from what you typed – otherwise retried / replaced
                                       ▼
                          reply + (optional) summary card with Confirm / Cancel
Confirm button ──POST /api/v1/chat/confirm──▶ LeadService.submit (the SAME code path as the form)
```

- **Which API:** whichever model `.env` configures, always called from the server, so the browser never sees a key.
  - **Google Gemini** goes through Google's OpenAI-compatible endpoint. This is what was tested.
  - **Claude** goes through the Anthropic Messages API with the official SDK. The default model is `claude-opus-5-5`, with adaptive thinking at low effort (`ANTHROPIC_EFFORT=low`).
- **Thinking signatures:** both Gemini 3 and Claude attach signed "thinking" data to their tool calls. The adapters send it back unchanged with the conversation; without it, Gemini rejects every follow-up request.
- **Without a key** (the default after cloning), the same tools and guards are driven by a deterministic, rule-based engine (`RuleBasedProvider`). It understands English and Hinglish, and it is what `npm test` and `npm run eval` use, so they need no network and no money. It is **not** an AI model. The UI says "offline assistant" when it is the one answering.
- **If Claude is unreachable** (bad key, outage, timeout), that turn falls back to the offline assistant instead of showing an error.
- **The model can never:** do the maths (numbers come from tools and are checked), file an application (only the Confirm button does, and typing "yes" does not), see a full mobile number in tool results, or talk about anything except gold loans.
- Full design: [docs/AGENT_DESIGN.md](docs/AGENT_DESIGN.md).

---

## Applicant side and admin side

The PDF asks for **one** single-page app with a three-step application flow **and an admin view**. It does not ask for separate portals or for a login, so this is one app with two clearly separated areas:

| Area | Pages | Who |
| --- | --- | --- |
| Applicant | **Apply** (form), **Track** (look up your application by ID + mobile), **Loan Assist** chat | Borrowers and field agents |
| Admin | **Admin** (all applications, filters, status actions, details drawer with full history) | Lender staff |

The admin view has **no login** in this demo (the brief doesn't ask for one). Mobile numbers are masked everywhere it shows them. Adding authentication is the first item under "What I would do with more time".

---

## The PDF, requirement by requirement

✅ done and tested · ⚠️ partly done · ❌ not done

### Part A: backend API and business rules

| Requirement | Status | Where / how it is checked |
| --- | --- | --- |
| `GET /api/v1/loan-schemes`: active plans with id, name, interest, tenure, max LTV (≤ 75%), seeded from the DB | ✅ | `routes/catalog.ts`; seed `db/seed.ts`; `http.test.ts` |
| `POST /api/v1/quotes`: pure calculation, no DB write; pure gold, gold value, eligible loan per plan | ✅ | `QuoteService` (has no write access); `http.test.ts` "writes nothing" |
| `POST /api/v1/leads`: validate, recompute on the server, de-duplicate, store `SUBMITTED`, `201` + `applicationId` | ✅ | `LeadService.submit`; client-sent amounts are stripped by the schema |
| `GET /api/v1/leads`: newest first, mobile always masked; pagination (bonus) | ✅ | `LeadService.list`; `page`, `pageSize`, `planId`, `status` filters |
| Validation → 400: name 2–60 letters/spaces, mobile `^[6-9]\d{9}$`, `0 < net ≤ gross ≤ 1000 g`, karat 18/22/24 | ✅ | `packages/shared/src/schemas.ts` + DB `CHECK`s; `schemas.test.ts`, `http.test.ts` |
| Unknown plan → 404 | ✅ | `PlanNotFoundError`; `http.test.ts` |
| Same mobile within 7 days → 409 with the existing `applicationId` | ✅ | `leadService.test.ts` (fake clock), `postgres.test.ts` |
| Safe for simultaneous requests (bonus) | ✅ | PostgreSQL advisory lock in a transaction; 2-parallel and 25-parallel tests on real PostgreSQL |
| Error body `{ error: { code, message, fields[] } }`; 500s as JSON without stack traces; async errors handled | ✅ | `lib/errors.ts`, `errorHandler.ts`, `asyncHandler.ts`; `http.test.ts` |
| Money in integer paise / whole rupees, never float; LTV ≤ 75% enforced on the server | ✅ | BigInt maths in `QuoteCalculator`; `CHECK (max_ltv_bps <= 7500)` and `applied_ltv_bps <= 7500` in the DB |
| Seeded plans `PLAN_BULLET_01` (12%, 70%, 12 mo) and `PLAN_EMI_01` (10.5%, 75%, 12 mo), mock rate ₹7,000/g | ✅ | `db/seedData.ts` |
| Migrations and a seed script | ✅ | `db/migrations/*.sql`, run automatically on start |
| Test cases 1–6 | ✅ | 45 g 22K EMI → 41.25 g, ₹2,88,750, ₹2,16,562 · Bullet → ₹2,02,125 · 10 g 18K → 7.5 g, ₹52,500, ₹39,375 · net > gross → 400 on `netWeightGrams` · bad mobile → 400 on `mobileNumber` · repeat → 409 |
| Test case 7 (bonus): same `Idempotency-Key` replays the original 201 | ✅ | `leadService.test.ts`, `http.test.ts`, `postgres.test.ts` |
| Test case 8 (bonus): 2 parallel requests → exactly one 201 and one 409 | ✅ | in memory and on PostgreSQL |
| Status workflow `SUBMITTED → UNDER_REVIEW → APPROVED / REJECTED` with audit log (bonus) | ✅ | compare-and-set update + `lead_audit` table |

### Part A: web portal

| Requirement | Status | Where |
| --- | --- | --- |
| Step 1 Details: name, mobile, gross and net weight, karat, inline validation as you type | ✅ | `DetailsStep.tsx` (same Zod schema as the server) |
| Step 2 Live quote: pure gold, value and loan per plan as selectable cards, `/quotes` debounced ~300 ms, selected card highlighted | ✅ | `PlanStep.tsx`, `useQuote.ts` (debounce, abort, cache) |
| Step 3 Confirm: review, submit, success screen with Application ID, friendly 409 ("You already applied on 14 Oct, application GL-1001") | ✅ | `ConfirmStep.tsx`, `SuccessScreen.tsx`, `ApplyPage.tsx` |
| Inline field errors from the API's `fields[]` | ✅ | `ApplyPage.tsx` maps them onto the inputs |
| Admin table: newest first, masked mobile `9876XXXX10`, net weight, plan, loan, status, filter by plan | ✅ | `LeadsTable.tsx` (also status filter, EMI column, paging) |
| Works at 375 px with numeric keypads for weights and mobile | ✅ | checked in a 375 px browser; `inputMode="decimal"` / `"numeric"` |
| Never commit keys; ship `.env.example`; document the LLM used | ✅ | `.env` is git-ignored; this README |

Beyond the brief, because the review and success screens should show what the applicant is agreeing to: the review step and the success screen show **monthly EMI (or interest at maturity), total interest, total repayable and the LTV applied**; applicants can **track** an application again; admins can open **any** application, in any status, with its full history.

### Part B: AI Loan Assist agent

| Requirement | Status | Where |
| --- | --- | --- |
| `get_loan_schemes()`, `calculate_quote(net, gross, karat)`, `submit_application(payload)` | ✅ | `agent/tools.ts` |
| The model never does the maths; every number comes from a tool | ✅ | tools return pre-formatted figures; `GroundingGuard` rejects any figure not in a tool result |
| `submit_application` runs only after a confirmation step in the UI that shows the full summary | ✅ | the tool only prepares a card; `POST /chat/confirm` (the Confirm button) files it |
| Tool arguments validated with the same Zod schemas; invalid calls go back to the model to ask the user | ✅ | `AgentTool.execute` |
| Stays on gold loans; no investment advice; no approval promises; declines off-topic | ✅ | `InputGuard`, `prompt.ts`, evals |
| Mobile numbers masked in logs; no API keys in the browser | ✅ | `scrubDeep` logger; LLM calls are server-side |
| A lead filed by the agent is identical to one filed by the form | ✅ | both go through `LeadService.submit` |
| 5 test conversations (happy path, missing field, net > gross, duplicate, off-topic) | ✅ | `npm run eval` (`evals/scenarios.ts`) |
| Bonus: prompt injection, Hinglish, change of mind, 10+ automated evals | ✅ | 16 scenarios in total |

### Bonus tasks (pick any)

| Bonus | Status | Notes |
| --- | --- | --- |
| B1 Harden the backend | ✅ | concurrency-safe duplicates, `Idempotency-Key`, status workflow + audit log, cached gold-rate endpoint (`GET /gold-rate`) |
| B2 Smarter agent | ⚠️ | ✅ 4th tool `check_existing_application`, ✅ prompt-injection tests, ✅ tool-status chips. ❌ **Streamed replies are not implemented** (each reply arrives in one piece) |
| B3 AI extras | ❌ | Not attempted (appraisal-slip photo reading, plain-English admin filter) |
| B4 Ops ready | ⚠️ | ✅ `docker compose up`, ✅ GitHub Actions workflow, ✅ rate limit on `/leads` and the chat, ✅ ARCHITECTURE.md. ❌ **No 2-minute demo video** yet |

### Deliverables

| Item | Status |
| --- | --- |
| GitHub repo where `npm install`, `npm run dev` and `npm test` work | ✅ checked from a clean copy with no `node_modules` and no `.env` |
| README: setup, env vars, what I'd do with more time | ✅ this file |
| `.env.example`, no committed keys | ✅ |
| AI_LOG.md: tools used, 2 exact prompts, 1 place the AI got it wrong + the test that catches it | ⚠️ written; a few lines marked `TODO (you)` must be completed by the person submitting, because only they know them |

---

## API

| Method & path | What it does |
| --- | --- |
| `GET /api/v1/loan-schemes` | Active plans from the database |
| `POST /api/v1/quotes` | Quote for every plan. No database write |
| `POST /api/v1/leads` | Create an application. `Idempotency-Key` header supported. 201 / 400 / 404 / 409 |
| `GET /api/v1/leads` | Newest first, masked mobiles. `page`, `pageSize`, `planId`, `status` |
| `GET /api/v1/leads/:applicationId` | One application in full: plan terms, EMI / interest, history (admin) |
| `POST /api/v1/leads/lookup` | Applicant lookup with `{ applicationId, mobileNumber }`; both must match, and a wrong ID or a wrong mobile gets the same 404 |
| `PATCH /api/v1/leads/:applicationId/status` | Status workflow (compare-and-set) |
| `GET /api/v1/leads/:applicationId/audit` | Audit trail |
| `POST /api/v1/chat`, `POST /api/v1/chat/confirm` | The AI agent; confirm is the only way it files an application |
| `GET /api/v1/gold-rate`, `GET /api/v1/health` | Cached mock rate; liveness, storage and assistant in use |

Every error has the same shape and an unexpected failure returns JSON 500 with no stack trace:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "fields": [{ "field": "netWeightGrams", "message": "…" }] } }
```

**Money maths has no floats.** Weights are integer milligrams, money is integer paise, percentages are basis points, and everything is `BigInt`:

```
pureGold   = net × karat / 24
goldValue  = pureGold × ₹7,000
loan       = floor(goldValue × min(plan LTV, 0.75))
EMI        = P·r·(1+r)^n / ((1+r)^n − 1), rounded to the paisa   (indicative; Bullet = simple interest at maturity)
```

Each application stores the plan terms it was filed with (migration `002`), so its EMI / interest never changes if a plan is edited later.

---

## Environment variables

All are optional. See [.env.example](.env.example); invalid values stop startup with a clear message.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4000` | API port |
| `WEB_ORIGIN` | `http://localhost:5173` | Allowed CORS origin |
| `DB_DRIVER` | `auto` | `auto` (PostgreSQL if `DATABASE_URL` is set, else memory) · `postgres` · `memory` |
| `DATABASE_URL` | – | e.g. `postgresql://gold:gold@localhost:5432/goldloan` (`npm run dev:pg` sets it for you) |
| `MOCK_GOLD_RATE_24K_RUPEES` | `7000` | The mock 24K rate per gram |
| `GOLD_RATE_CACHE_TTL_MS` | `60000` | Rate cache lifetime |
| `RATE_LIMIT_WINDOW_MS` / `_LEADS_MAX` / `_CHAT_MAX` | `60000` / `20` / `40` | Per-IP limits (`_LEADS_MAX` also limits applicant lookups) |
| `LLM_PROVIDER` | `auto` | `anthropic` · `openai` · `offline`. `auto` picks by which key is set |
| `ANTHROPIC_API_KEY` | – | Turns on Claude. API keys are billed per use from prepaid credits at console.anthropic.com, separately from a Claude Pro / Max subscription |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Claude model id |
| `ANTHROPIC_EFFORT` | `low` | `low` · `medium` · `high` · `xhigh` · `max`: how much the model thinks before answering |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | – / OpenAI / `gpt-4o-mini` | Any OpenAI-compatible API. For Gemini: your Gemini key, `https://generativelanguage.googleapis.com/v1beta/openai`, `gemini-3.5-flash-lite` |
| `AGENT_MAX_TOOL_STEPS` | `6` | Tool-loop step limit per message |
| `AGENT_SESSION_TTL_MS` | `1800000` | Chat session lifetime (30 min) |
| `LLM_TIMEOUT_MS` | `30000` | Per model call |
| `FRAME_ANCESTORS` | – | Origins allowed to embed the app in an iframe (set automatically inside a Hugging Face Space) |

---

## What was tested, and how

Run on Windows 11, Node 24, PostgreSQL 16 (Docker) on 14 Oct 2026:

| Check | Result |
| --- | --- |
| `npm run typecheck` (shared, API, web) | clean |
| `npm run test:pg`: every test, including the PostgreSQL ones | **160 passed, 0 failed, 0 skipped** (22 shared + 138 API) |
| `npm test` without a database | passes; the 10 PostgreSQL tests are skipped |
| `npm run eval` (offline assistant) | **16/16** conversations, including the 5 required ones |
| `npm run eval -- --live` on **Gemini 3.5 Flash-Lite** (free tier) | **5/5 judged conversations passed** (happy path, missing field, net > gross, typed "yes" is not a confirmation, double Confirm). The other 11 were **not judged**: the free-tier quota ran out mid-run (HTTP 429), so the offline fallback answered them. The runner now refuses to count those as passes |
| Live chat on Gemini through the app | The PDF's example "I have 45 grams of 22 carat jewellery, how much can I get?" → Gemini asks for the gross weight instead of assuming it. A full chat ended with GL-1044 filed after Confirm, with every figure matching the PDF |
| Clean copy (no `node_modules`, no `.env`): `npm install` → `npm test` → `npm run build` → start | all worked first time; test case 3 returned exactly 7.5 g / ₹52,500 / ₹39,375 |
| `docker compose up --build` | app + PostgreSQL healthy, application created with the PDF figures, web page served |
| Browser (headless Chrome, 1440 px and 375 px, light and dark) on PostgreSQL | apply → submit → success with EMI → track → admin approve / reject → history still visible → duplicate shows the friendly 409; chat → summary card with EMI → Confirm files the application |
| Production build in the browser | no console errors, no blocked scripts, fonts and images load |
| GitHub Actions (runs on every push) | passing: typecheck, all tests with a PostgreSQL service, 16/16 offline evals, build |

**Not yet tested:**

- **A complete 16/16 live run on Gemini.** The free tier's quota ran out. Re-run `npm run eval -- --live` when it resets; it reports any conversation the fallback had to answer as "not judged".
- **Live calls to Claude.** No Claude key was available. The adapter is covered by unit tests with a fake transport. A live run is about 100 model calls, roughly US$2–3 at Claude Opus 5.5 prices.
- Hugging Face deployment.

---

## Project layout

```
apps/api/src
  domain/        QuoteCalculator, LoanScheme, Lead   (pure business rules, no I/O)
  services/      QuoteService, LeadService, GoldRateProvider (use-cases; shared by REST and the agent)
  repositories/  interfaces + memory / postgres / cached implementations
  agent/         AgentOrchestrator, tools, guards, session store, providers (Anthropic SDK, OpenAI-compatible, offline)
  http/          Express app, routes, middleware (validation, errors, rate limit, request id)
  db/            SQL migrations, seed, runner
apps/web/src
  components/    ApplyPage (+ DetailsStep, PlanStep, ConfirmStep), SuccessScreen, TrackPage, LeadsTable + LeadDrawer,
                 ApplicationDetails, ChatPanel, Sidebar, TopNav, About
  hooks/ lib/ api/   quote debounce, theme, health, history, API client
  styles.css, assets/bg   theme and background photos
packages/shared  Zod schemas, constants, money / weight formatting, mobile masking
scripts/         dev-pg.mjs, test-pg.mjs (the one-command PostgreSQL helpers)
evals/           agent scenarios + runner
docs/            project plan, agent design
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API (watch) and web (Vite) together; PostgreSQL if `.env` has `DATABASE_URL`, else in-memory |
| `npm run dev:pg` | Starts PostgreSQL in Docker and runs the app on it |
| `npm test` | Shared + API tests (PostgreSQL tests run only if `TEST_DATABASE_URL` is set) |
| `npm run test:pg` | All tests including PostgreSQL (uses a separate `goldloan_test` database) |
| `npm run eval` | Agent conversations (offline). `npm run eval -- --live` uses your configured LLM |
| `npm run typecheck` | `tsc` for all three packages |
| `npm run build` | Production build of the web app |
| `npm start` | API only; serves `apps/web/dist` if it has been built |
| `npm run db:up` / `db:down` / `db:migrate` / `db:seed` | Database helpers |

---

## Honest notes

- **Admin has no login.** The brief asks for an admin table, not authentication. Anyone who can open the app can see the (masked) list and change statuses.
- **Chat sessions live in memory,** so a restart ends open chats. More than one API instance would need Redis (`SessionStore` is the only class to swap).
- **EMI, interest and total repayable are indicative** and labelled as such. Only the loan amount is specified by the brief.
- **Application IDs can skip numbers** after a database restart (normal PostgreSQL sequence behaviour). They are always unique.
- **No ORM.** The brief suggests Prisma, Drizzle or Knex. This uses plain SQL with `pg` and its own small migration runner.

## Credits

Background photos are public domain (CC0), found through [Openverse](https://openverse.org): *Gold bullion bars* (Wikimedia Commons), *Gold bars* and *Gold bangle bracelets* (rawpixel). They were cut out and compressed to WebP for `apps/web/src/assets/bg`. Fonts: DM Sans and Playfair Display (SIL Open Font License), self-hosted through Fontsource.

## What I would do with more time

1. Authentication and roles for the admin view (SSO plus an `admin` role), with the audit actor taken from the login.
2. Streamed chat replies (bonus B2) and the appraisal-slip photo reader (bonus B3).
3. Redis for chat sessions and rate limits, so the API can run as several instances.
4. Encrypt mobile numbers at rest, with a keyed hash for the duplicate lookup.
5. Playwright end-to-end tests in CI, and a live-LLM eval run with a pass-rate threshold.
6. A real gold-rate feed behind the existing `GoldRateProvider` interface.
7. Observability: traces across agent steps, metrics for quote latency, duplicate rate and guard triggers.
