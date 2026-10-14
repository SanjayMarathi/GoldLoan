# Project plan and requirement checklist

## 1. The project in one paragraph

A partner lending company wants a small **gold-loan portal**. A customer enters their gold's weight and purity and sees what they could borrow under two plans. They then apply in three steps, and staff see every application in an admin table. The same job can also be done by chatting with an **AI agent**, which must behave like a careful human data-entry operator: it must not make up numbers and must not file anything the customer didn't confirm.

Scope decisions:

- One mock 24K gold rate of ₹7,000 per gram, as the brief says. There is **no state-wise or country-wise price and no currency conversion**: the brief doesn't ask for it, and the rate sits behind a `GoldRateProvider` interface if a feed is ever added.
- Gold value and eligible loan are different numbers on purpose. *Gold value* is what the pure gold is worth at today's rate. *Eligible loan* is only a share of that value (the loan-to-value ratio, **70%** for Bullet and **75%** for EMI, never above 75%), so the lender stays covered if gold prices fall.

## 2. How the maths works

```
pure gold   = net weight × karat / 24
gold value  = pure gold × ₹7,000
eligible    = floor( gold value × min(plan LTV, 75%) )

Example: 45 g · 22K → pure 41.25 g → value ₹2,88,750
         Bullet (70%) ₹2,02,125      EMI (75%) ₹2,16,562
```

## 3. Tech stack (as specified)

| Area | Choice |
| --- | --- |
| Backend | Node.js 22, Express, TypeScript, Zod |
| Database | PostgreSQL, with SQL migrations and a seed |
| Frontend | React single-page app (Vite) |
| Agent | Tool-calling LLM through a provider interface; deterministic offline engine as default |
| Extras | npm workspaces, `node:test`, Docker Compose, GitHub Actions |

## 4. Requirement traceability

Everything in the assignment brief, and where to find it.

### Backend

| Requirement | Where | Proof |
| --- | --- | --- |
| `GET /api/v1/loan-schemes` | `routes/catalog.ts`, `LoanSchemeRepository` | `http.test.ts` |
| `POST /quotes`: pure calculation, no DB write | `routes/quotes.ts`, `QuoteService`, `QuoteCalculator`. `QuoteService` is only given the plan repository and the rate provider, so it has no way to write a lead | `quoteCalculator.test.ts`; `http.test.ts` → "POST /quotes … and it writes nothing" |
| `POST /leads`: validate, server recompute, `SUBMITTED`, `201` + `applicationId` | `LeadService.submit` | `leadService.test.ts` cases 1–8 |
| Duplicate mobile within 7 days → `409` with the existing `applicationId` | `LeadService.submit` inside the per-mobile lock | `leadService.test.ts` (7-day window with a fake clock) |
| `GET /leads`: newest first, masked mobile | `LeadService.list`, `maskMobile` | `leadService.test.ts`, `mask.test.ts` |
| Pagination *(bonus)* | `ListLeadsQuerySchema` (`page`, `pageSize`) | tests + UI |
| Name 2–60 letters; mobile `^[6-9]\d{9}$`; `0 < net ≤ gross ≤ 1000 g`; karat 18/22/24 | `packages/shared/src/schemas.ts` + DB `CHECK`s | `schemas.test.ts`, `postgres.test.ts` |
| Unknown plan → 404 | `PlanNotFoundError` | `leadService.test.ts` |
| Error body `{ error: { code, message, fields[] } }`; JSON 500 without stack | `errors.ts`, `errorHandler.ts` | `http.test.ts` |
| No floating-point money | BigInt, integer mg / paise / bps | `quoteCalculator.test.ts` (rounding edges) |
| Plans `PLAN_BULLET_01` (12%, 70%, 12 mo), `PLAN_EMI_01` (10.5%, 75%, 12 mo) | `db/seedData.ts`, `001_init.sql` | seed + tests |
| Migrations + seed | `db/migrate.ts`, `db/seed.ts` | run automatically on start |
| Test cases 1–8, including idempotency and parallel requests | `leadService.test.ts` | `npm test` |

### Frontend

| Requirement | Where |
| --- | --- |
| 3-step flow (details → live quote / plan → review & submit), on one scrollable page with a sticky progress bar | `ApplyPage.tsx`, `DetailsStep`, `PlanStep`, `ConfirmStep`, `Stepper` |
| Live debounced (~300 ms) quote shown as plan cards | `useQuote.ts`, `PlanCard.tsx` |
| Friendly 409 message | `ApplyPage.tsx` |
| Success screen and review show every figure (EMI / interest, total repayable, LTV) | `SuccessScreen.tsx`, `ConfirmStep.tsx`, `ApplicationDetails.tsx` |
| Applicant can check an application again (id + mobile) | `TrackPage.tsx`, `POST /leads/lookup` |
| Success screen with the application id | `SuccessScreen.tsx` |
| Admin table: masked mobile, net weight, plan, loan, status, filter by plan | `LeadsTable.tsx` (plus EMI column, status filter, paging, workflow actions) and `LeadDrawer.tsx` (full details + history for any status, `GET /leads/:id`) |
| Responsive (375 px) | `styles.css` (tables become cards under 760 px) |
| Gold & white / gold & black theme with gold photography in the background (sidebar, floating nav pill, card, light/dark switch) | `styles.css`, `Sidebar.tsx`, `TopNav.tsx` |

### AI agent

| Requirement | Where |
| --- | --- |
| Tools `get_loan_schemes`, `calculate_quote`, `submit_application` | `agent/tools.ts` |
| `submit_application` only after UI confirmation | `AgentOrchestrator.handleConfirmation`, `POST /chat/confirm`, Confirm card in `ChatPanel.tsx` |
| Same Zod schemas as the REST API | tools import `QuoteRequestSchema`, `CreateLeadSchema` from `@gold/shared` |
| Same service layer as the form | tools call `QuoteService` / `LeadService` |
| Guardrails: injection, off-topic, no invented numbers, no approval promises, no advice | `InputGuard`, `GroundingGuard`, `prompt.ts` |
| Privacy | masked mobiles everywhere, no PII in logs, keys server-side only |
| 5 required test conversations (`npm run eval`) | `evals/scenarios.ts` (11 more beyond the required five) |

### Deliverables

| Deliverable | Status |
| --- | --- |
| Repo where `npm install`, `npm run dev`, `npm test` work | ✅ (needs one real `npm install`; see README "Honest notes") |
| README: setup, env vars, which LLM, bonuses, what's next | ✅ `README.md` |
| `.env.example`, no committed keys | ✅ |
| `AI_LOG.md` (tools, 2 prompts, one real mistake, the test that catches it) | ✅ with `TODO (you)` items to complete |
| Bonuses B1–B4, docker compose, CI, rate limit, injection tests, ARCHITECTURE.md | ✅ see README |

## 5. Build plan (48-hour take-home)

| Phase | Hours | Output | Done when |
| --- | --- | --- | --- |
| 1. Foundations | 0–4 | Monorepo, shared Zod schemas, constants, formatting and masking | Shared tests green |
| 2. Core domain | 4–10 | `QuoteCalculator` (BigInt), plans, migrations, seed | Brief's examples reproduce exactly |
| 3. API | 10–18 | Repositories (memory + Postgres), services, routes, errors, concurrency, idempotency | Test cases 1–8 and the 20-parallel test pass |
| 4. Web UI | 18–28 | Wizard, live quote, admin table, theme, responsive | Walk-through at 375 px and desktop |
| 5. Agent | 28–38 | Tools, orchestrator, guards, providers, offline engine | The 5 required conversations pass |
| 6. Hardening | 38–44 | Bonuses (workflow, audit, rate limit), evals, injection tests | `npm run eval` 16/16 |
| 7. Delivery | 44–48 | Docs, Docker, CI, AI_LOG, final run-through on a clean clone | Fresh clone: `npm install && npm test && npm run dev` |

Build order (in this project it was backend first, then agent, then UI) follows the dependency chain: shared → domain → services → routes → agent → UI.

## 6. Risks and how they are handled

| Risk | Mitigation |
| --- | --- |
| Rounding drift in money maths | BigInt everywhere, one division at the end, examples from the brief asserted |
| Race in the duplicate check | Per-mobile advisory lock inside a transaction; 20-parallel test; DB `UNIQUE` on `application_id` |
| User double-clicks or retries | `Idempotency-Key` replay; chat confirm is idempotent per `actionId` |
| LLM hallucinates a number or "submits" on its own | Tools return pre-formatted strings, the grounding guard checks every figure, and no tool can file a lead without a click on Confirm |
| LLM or API key unavailable at review time | Offline engine is the default and the automatic fallback |
| Prompt injection | Input guard, schema-validated tools, server-enforced confirmation, tests and evals |
| PII exposure | Masking on every output path; keys server-side |
| Unverified code paths | Everything except live LLM calls has now been run locally (see README → What was tested); CI runs it again, Postgres included, on every push |
| Reviewer can't run it | In-memory default needs no database; `docker compose up` for the full stack |

## 7. Definition of done

1. `npm install && npm test` passes on a clean clone, and `npm run eval` shows 16/16.
2. `npm run dev` (or `npm run dev:pg` on PostgreSQL) serves the application page, Track, the admin table and the chat. The quote for 45 g · 22K shows ₹2,02,125 and ₹2,16,562.
3. A duplicate mobile shows the friendly message with the existing id.
4. The chat can complete an application, and it only files after Confirm.
5. No secrets in the repo, and the README states plainly what was and wasn't run.
