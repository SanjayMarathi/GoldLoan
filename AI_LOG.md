# AI_LOG.md

> This log records how AI was used on this project. Lines marked **`TODO (you)`** can only be filled in by the person submitting this repository. Fill them in with what actually happened before you submit.

## 1. Tools used

| Tool | Used for |
| --- | --- |
| Claude Code, session 1 (the session's own log names Claude Sonnet 5.5) | Planning and writing the first version: the monorepo (shared package, API, agent, React UI), the tests, evals, Docker/CI files and the docs |
| Claude Code, session 2 (Claude Opus 5.5) | Theme redesign (gold & white / gold & black with gold photography), checking the project against the PDF, switching on and testing PostgreSQL, rewriting the Claude adapter on the official SDK, the scrollable application page, the Track page, the admin details drawer, EMI on every summary, and the README / AI_LOG rewrite. It ran every test, the Docker build and headless-browser checks itself |
| Headless Chrome via `puppeteer-core` (driven by Claude Code) | Checking the real UI against the running app: 375 px and 1440 px, light and dark, the full apply → track → admin → approve flow on PostgreSQL, the chat → Confirm flow, the production build |
| Openverse API | Finding public-domain (CC0) gold photos for the background |
| The product at run time | **Google Gemini 3.5 Flash-Lite** (free tier, via Google's OpenAI-compatible endpoint) is the model it was tested with. Claude Opus 5.5 is supported through the official Anthropic SDK but has not made a live call (no paid key). With no key, the deterministic offline engine runs, so the project works and is tested without any key |

`TODO (you)`: add anything else you used (ChatGPT, Copilot, Gemini, search, docs…), and roughly how many hours you spent reading, running and changing the code yourself.

## 2. Exact prompts

These are copied exactly as they were sent, typos included. None of them was written as a narrow "validation prompt" or "agent tools prompt"; they are the real prompts that produced that work.

### Prompt 1: the build request (session 1)

Sent with the assignment PDF and a screenshot of a reference UI. It produced the validation rules (`packages/shared/src/schemas.ts`) and the agent tools (`apps/api/src/agent/tools.ts`), both derived from the PDF text:

```
so build and give me complete project use this type of theme with gold in background and add planning of the project system design everything whatever mentioned in the pdf what are the requirements mentioned in the pdf the project should consist of all the requirements mentioned in the given pdf with maintaining proper system design object oriented programming, faster execution how we can integrate chatbot which should work as good as human entry.
```

### Prompt 2: the PDF audit, validation and the agent (session 2)

Sent with the assignment PDF attached again. It led to the requirement-by-requirement check in the README, the decision to keep one SPA with an admin view, PostgreSQL being switched on and tested, the agent being moved to Claude through the official SDK (the user picked "Anthropic Claude" when asked which model should power it), EMI on every summary, the Track page, and the admin history fix:

```
i need everything mentioned in the given pdf there is something like i have given you file again check weather all criteria are met i dont want to mess anything write in readme file about what i used also everything written in it should be transperancy.  did they asked for different admin and user portal check that also and key details are missing after submission the important things like montly emi nothing is showing in review. form can be more beatiful like completly scrollable interface will be good. how ai assistent is running i am not understading there, which api its using i want to use postgres sql tell me how should i implement that its also mentioned it should run with simple commands from github repo read that also and make complete correction according to pdf. once application approved we cant take look at that history it should also be changed. every details should be able to check for user again and also admin with specified details in pdf
```

### Prompt 3: the theme (session 2)

Sent with a screenshot of another app as a style reference:

```
currently the theme is fully looks vibe coded that should be minimized and run the project create a repo in github and pushit also in hugging face i want lighter theme. something like this which consists of images in background of gold and all with beatiful frontend with same gold and white and gold and black theme, the given image reference only dont convert like that only its for background simplicity of design you should maintain the current design of the project with updating with given image and also run the project locally first then i will give further steps
```

`TODO (you)`: if you wrote a separate, more specific prompt for validation or for the agent tools, paste it here **exactly as you sent it**. Please don't paste a prompt you didn't use.

## 3. A real place the AI got it wrong

### The Claude adapter would have failed on its first real call

**What happened.** In session 1 the AI wrote `AnthropicProvider` with plain `fetch`. Its request body contained:

- `temperature: 0.2`, which current Claude models reject with HTTP 400;
- `max_tokens: 700`, too small once the model's thinking counts towards it;
- a hard-coded default model, and no handling of thinking blocks, so the conversation history it sent back would not have matched what the API returned.

Because the agent falls back to the offline assistant whenever the model call fails, this would **not** have shown up as an error. Every chat would quietly have been answered by the rule-based engine while looking like "the AI". The only sign would have been the small "Offline assistant (AI is busy)" label in the chat header.

**How it was spotted.** In session 2, before turning on an API key, the AI checked the adapter line by line against the current Claude API reference. That review found the `temperature` parameter and the undersized `max_tokens`. No live call was made, because no key was available.

**The fix.** The adapter now uses the official `@anthropic-ai/sdk`:

- `claude-opus-5-5` with adaptive thinking and a configurable effort, and no sampling parameters;
- `max_tokens` sized for thinking;
- Claude's turns replayed exactly as returned, thinking blocks included;
- server-side `fallbacks` for policy declines;
- refusals and truncated tool calls are never executed.

**Tests that catch it now** (`apps/api/tests/providers.test.ts`):

- *"builds a request the current models accept: no sampling params, adaptive thinking, room for thinking"*. It asserts there is no `temperature` / `top_p`, that `max_tokens ≥ 8000`, that adaptive thinking is on, and that `tool_choice` is never forced.
- *"replays this provider's own turns verbatim, thinking blocks included, and rebuilds other turns"*.
- *"reads blocks by type, keeps the raw turn for replay, and never runs a refused or truncated turn"*.

**Still open, honestly:** the adapter has not yet talked to the real API. Once a key is in `.env`, run `npm run eval -- --live` and write the result here.

### The Gemini adapter failed the same way, and the live results were over-reported

**What happened.** When a free Gemini key was added in session 2, every chat turn was still answered by the offline engine. The AI-written OpenAI-compatible adapter rebuilt the conversation history without the `thought_signature` that Gemini 3 attaches to each tool call. Gemini answered every follow-up request with HTTP 400 ("Function call is missing a thought_signature"), and the agent quietly fell back to the offline engine. The adapter also had the same `temperature: 0.2` / `max_tokens: 700` flaw as the Claude one.

**How it was spotted.** Each reply carried `degraded: true` and the server log showed the 400.

**The fix.** The adapter now replays Gemini's tool calls exactly as returned, signature included. It sends no `temperature`, and `max_tokens` leaves room for thinking.

**Tests that catch it now.** `providers.test.ts` → *"replays Gemini's thought_signature on its own tool calls, and never sends it to another model"* and *"sends no temperature, leaves room for thinking…"*.

**Then the AI over-reported the live results.** It reported 13/16 and then 15/16 conversations passing "on Gemini". Some of those answers had in fact come from the offline fallback, because Gemini was overloaded (503) and later out of free quota (429), and the eval runner counted fallback answers as passes. It was noticed when a "passing" reply was word-for-word the offline engine's template.

The runner now marks any conversation where the fallback answered as **NOT JUDGED**, never as a pass. The honest result is in the README: 5/5 judged conversations passed, and 11 were not judged because of the quota. There is no automated test for the runner itself.

### Earlier: "22 karat" read as 22 grams (session 1)

The first version of the offline assistant's parser (`apps/api/src/agent/nlu.ts`) read **"22 karat" as a net weight of 22 grams**. The bot asked "What is the net weight?", the user answered "22 karat", and the bare-number fallback stored 22 g. It was found while exercising the "missing field" conversation, because the next question skipped ahead to the gross weight. Karat expressions are now removed before the bare-number fallback runs. The guards are `apps/api/tests/agent.test.ts` → *"Scenario 2 – missing field"* and `evals/scenarios.ts` → `missing-field`, step 2.

`TODO (you)`: if you remember either discovery differently (for example you spotted it yourself in the browser), say so here in your own words.

### Other mistakes caught along the way

| Session | Mistake | How it was caught | Fix and guard |
| --- | --- | --- | --- |
| 2 | On live Gemini the system prompt was too soft. Given "45 grams of 22 carat jewellery", the model assumed gross = net instead of asking. It also left pure gold / gold value out of quotes, and answered "22 karat gold" in Hinglish | Live testing with the Gemini key | The three rules are now explicit in `prompt.ts`. Re-checked on live Gemini: it now asks for the gross weight, opens quotes with "41.25 g of pure gold, worth ₹2,88,750", and replies in English |
| 2 | The AI's own edit script wrote invisible **backspace characters** into an eval pattern (a `\b` word boundary became the control character 0x08), so the off-topic check could never match | `npm run eval` dropped from 16/16 to 15/16 on the deterministic offline engine – the offline run caught a bug in the test itself | Pattern rewritten; every edited file scanned for control characters |
| 2 | Three more checks tested the offline engine's exact sentences, not the meaning: "already has an application" (Gemini: "a recent application … was already filed"), "only help with gold loans" ("only help **you** with gold loans"), "can't give investment advice" ("**cannot** give investment advice") | The full live run on Gemini (12/16, no fallback turns) | They now check the meaning (each pattern is in `evals/scenarios.ts`); re-run live: all three pass. The Hinglish failure was **not** loosened – it is a real model failure and stays a failure |
| 2 | Two eval checks were stricter than the rule they test. One demanded the exact words "more than gross", and Gemini wrote "more than **the** gross". The other forbade "gross weight" after "22 karat", although the prompt tells the model to ask for both weights; that check guards an offline-parser bug | Reading the failing live transcripts | The wording check accepts natural phrasing. The parser check now applies to the offline engine only (`offlineReplyLacks`), so it still guards that bug. These were changed to accept correct behaviour, not to hide failures |
| 2 | Told the user that a live Claude eval run costs "a few cents". It is roughly US$2–3 (about 100 calls at Claude Opus 5.5 prices) | Re-estimating from the prompt and tool sizes | README corrected |
| 2 | In the admin table, if the history panel was open when a status changed, it stayed on "Loading history…" forever. The cache was cleared but nothing re-fetched it | **Reported by the user**: "once application approved we cant take look at that history" | Replaced by a details drawer that reloads after every action. `http.test.ts` → *"GET /leads/:id → the full application after approval … the whole history"* covers the API; the UI was checked in a browser (no automated UI test) |
| 2 | The new admin drawer appeared trapped inside the table card instead of over the page (`position: fixed` inside an element with a transform animation) | Screenshot review | Rendered through a React portal. No automated test |
| 2 | The README said the lockfile was missing and the HTTP tests and build had never run, even after they had | Re-reading the README against what had actually been run | Corrected; the README now lists what was run, when, and the results |
| 2 | The cut-out of the gold-bar photo made the dark gaps between the bars transparent, so they looked silver | Visual check of the processed image | Dark pixels are kept opaque in the cut-out |
| 2 | The theme pre-paint script was inline, and the production security policy (`script-src 'self'`) blocks inline scripts | Checking the Docker build in a browser | Moved to `/theme-init.js` |
| 2 | ARCHITECTURE.md said application ids have no gaps; PostgreSQL skipped GL-1005…GL-1036 after a database restart | Noticed while testing `docker compose up` | Doc corrected (normal sequence behaviour; ids stay unique) |
| 1 | The mobile number on the chat confirmation card was masked twice | Test | `agent.test.ts` asserts the card shows `9876XXXX10` |
| 1 | `windowMessages` cut the history one message too late, orphaning tool messages | Test | `guards.test.ts` → *"windowMessages cuts at a user message so tool calls are never orphaned"* |
| 1 | "I want a home loan" was treated as on-topic because it contains "loan" | Test | `agent.test.ts` → *"declines other kinds of loan"* |
| 1 | A wrong **test** expectation about asking for the karat | Test run | The test was corrected, not the code |
| 1 | The Confirm message said "is now under review" while the status was still `SUBMITTED` | Review | Wording changed to "Our team will review it next" |

## 4. What has and hasn't been verified

In session 1 the AI worked without network access, so much of the code had never run. Session 2 ran all of it on a real machine (Windows 11, Node 24, PostgreSQL 16 in Docker):

| Item | Status |
| --- | --- |
| `npm install` and `package-lock.json` | ✅ generated and committed |
| Express layer (`http.test.ts`) | ✅ passes |
| PostgreSQL repository (`postgres.test.ts`), both migrations, seed, advisory locks with 2 and 25 parallel requests | ✅ passes on PostgreSQL 16 (`npm run test:pg`) |
| `vite build` | ✅ |
| `Dockerfile` and `docker compose up --build` | ✅ app + database healthy, application created |
| Clean-clone check: `npm install` → `npm test` → `npm run build` → start | ✅ |
| The Gemini adapter against the **live** API | ✅ works end to end in the app. Full live run: 12/16 with no fallback turns; after fixing three over-literal checks, those three passed on a live re-run. One real failure remains (Hinglish quote in English) |
| Hosted PostgreSQL (Neon, PostgreSQL 18.6) | ✅ connected with strict SSL; both migrations applied; plans seeded; quotes correct |
| The Claude adapter against the **live** API | ❌ not yet: no paid key. Unit tests with a fake transport only |
| GitHub Actions workflow | ✅ passes on every push (all tests incl. PostgreSQL, 16/16 offline evals, build) |

`TODO (you)`: when the Gemini free quota has reset, run `npm run eval -- --live` again and write one line here with the result (and do the same with Claude if you add a paid key).

## 5. How the work was divided

- **Decisions the user gave:**
  - use the PDF as the spec;
  - a gold theme from a reference screenshot, then a lighter, less "vibe-coded" gold & white / gold & black version;
  - PostgreSQL;
  - Claude as the model;
  - one scrollable application page;
  - EMI and full details after submission;
  - applicants and admins can both look at an application again, including after approval.
- **Decisions the AI proposed, which I should be able to defend:**
  - Integer/BigInt money maths.
  - Repository pattern with in-memory and PostgreSQL implementations.
  - Advisory-lock critical section for duplicate checks.
  - Server-enforced confirmation for the chatbot.
  - Grounding guard.
  - Offline fallback model.
  - Snapshotting plan terms on each application (migration 002).
  - Applicant lookup that needs both the application ID and the mobile number.
  - One SPA with an admin area rather than two portals.
- `TODO (you)`: read `ARCHITECTURE.md` and `docs/AGENT_DESIGN.md` until you can explain, without looking:
  1. why the confirmation can't be skipped by the model;
  2. why parallel requests produce exactly one 201;
  3. why the Track page needs both the ID and the mobile number.
