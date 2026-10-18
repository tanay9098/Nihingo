# Project memory (context for the next developer / AI tool)

Read this first. It summarises the project so you don't need to read the whole codebase, and keeps a log of changes.
**Update it after every change** (see [`RULES.md`](RULES.md) §4). Details live in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## What this is

**Nihongo Graph** — a Japanese-learning web app that remembers what a learner studied and adapts the next lesson.
Built for the FalkorDB hackathon, Track 2 (Agent Memory and Coordination). Learner memory is a FalkorDB graph; three agents
(Tutor, Examiner, Memory & Planner) coordinate only through that graph.

## Current state (as of 2026-10-18)

* **Stack**: Node ≥ 20 + Express 5 + `falkordb` npm client (the only two dependencies); vanilla JS frontend in `public/` (no build);
  FalkorDB in Docker; optional LLM (Anthropic/OpenAI via `fetch`) and optional Python GraphRAG-SDK sidecar.
* **Entry points**: `server/index.js` (boot) → `server/app.js` (all `/api` routes) → `server/services/learning.js` (agent orchestration).
* **Agents**: `server/agents/tutor.js` (reads + explains), `examiner.js` (selects + grades, no writes), `planner.js` (all memory writes,
  `decide()` policy, preferences). Pure helpers: `grade.js`, `mastery.js`, `pathway.js`.
* **Data access**: `server/graph/catalog.js` (content), `server/graph/memory.js` (learner memory, accounts), `schema.js` (indexes, `SCHEMA_VERSION` 2).
* **Accounts**: Sign in with Google (`server/services/google.js`, OAuth code flow + PKCE via `fetch`) or a guest account (no email, only its cookie;
  upgraded in place on Google sign-in), both in `server/services/auth.js`; HttpOnly cookie `nh_session`; each account owns one `Learner`
  (`learner:<uuid>`). Email + password is legacy (`PASSWORD_AUTH=1`). Visitors without any account see `learner:demo` (seeded, `isDemo: true`).
* **Learning path**: Hiragana → Katakana → First words → Sentence patterns → First kanji → JLPT N5 extension (`pathway.js`), computed from `STUDIES` edges.
* **Content**: `resources/original/` (MIT, curated), `resources/local/` (third-party JLPT N5 PDFs/CSV), `resources/external/lazybenkyou_videos.json` (15 videos).
* **Tests**: 61 in `tests/` (unit, ingestion, api, workflow, auth), all passing on 2026-10-18 against a real FalkorDB module. Run with `FALKORDB_PORT=<port> npm test`.
* **Boot**: `server/index.js` retries the database forever with backoff (`bootLoop`), so a late/misconfigured-then-fixed DB is picked up without a restart.
* **Deploy**: Render web service (Docker); FalkorDB must be external (`FALKORDB_HOST` ≠ localhost). README → *Deploying on Render* lists the env vars.
* **Not implemented / known gaps**: deleting a Google account; rate limit and per-learner lock are in-process
  (single instance); AI mode and GraphRAG sidecar not verified end-to-end with a real LLM; no stroke-order animation; no greetings/conversation step.

## Where to look for…

| Task | Files |
| --- | --- |
| Add/change an endpoint | `server/app.js` (+ service method), `public/js/api.js` caller, `tests/api.test.js`, endpoint table in `docs/ARCHITECTURE.md` |
| Change what gets recommended | `decide()` in `server/agents/planner.js`, `tests/unit.test.js` |
| Change exercise selection | `ExaminerAgent.selectExercises` in `server/agents/examiner.js` |
| Change grading | `server/agents/grade.js`, `tests/unit.test.js` |
| Change mastery / scheduling | `server/agents/mastery.js` |
| New graph label / relationship / index | `server/graph/schema.js` (`ID_LABELS`), `memory.js` or `catalog.js`, schema tables in `docs/ARCHITECTURE.md` |
| New content file format | `server/ingestion/files.js`, `mapping.js`, `records.js`, `tests/ingestion.test.js` |
| A frontend page | `public/js/<page>.js` (router in `public/js/app.js`), styles in `public/css/` |
| Config / env var | `server/config.js`, `.env.example`, `docker-compose.yml`, README configuration table |

## Conventions worth knowing

* All Cypher is parameterised; label/relationship names come from whitelists only.
* Every learner-owned node has `learnerId`; accounts link via `profileId` so a progress reset never deletes the account.
* Every memory write bumps `Learner.memoryVersion`; a stored recommendation with an older `stateVersion` is re-planned.
* Every agent step logs an `AgentEvent` (`server/agents/events.js`); the UI timeline only reads them and shows them as plain sentences, never raw data.
* Client-supplied ids (`sessionId`, `attemptId`, `logId`) are idempotent for the owner and refused (403/404/409) for anyone else.
* Demo mode is the default and must keep working without any LLM key.

## Change log

Newest first. One entry per change: date · summary · files · how it was tested.

* **2026-10-18** · Plain language, part 2: the *Why this recommendation?* box (`evidenceLines` in `utils.js`) now says *Reason: …*, *How well you
  know it: about 8%*, *Easy to confuse with “で”* instead of rule ids, raw mastery, `Graph path: CONTRASTS_WITH/REQUIRES` and the memory version.
  Server wording: Planner reasons say “only about 8% learned” instead of “(estimated mastery 0.078)” (`planner.js`); Examiner reason
  “Easy to confuse with “X”” instead of “Confusable with “X” (CONTRASTS_WITH)” (`examiner.js`); activity titles *Revise the basics first* /
  *Compare look-alike items* (`tutor.js`). Recommendations and agent events stored before this keep their old text in the graph, so it is reworded on
  read (`plainReason` in `tutor.js`, `legacyMessage` in `utils.js`, exercise reasons in `learning.js`): no migration. Also: % known in Due for review,
  Library item detail and graph tooltips; friendlier loading/empty/help text on Today, Practice, Library, Listening and sign-in. Field names and
  types unchanged. Files: `server/agents/{planner,examiner,tutor}.js`, `public/js/{utils,learning,dashboard,library,listening,memory,graph,auth}.js`,
  `tests/unit.test.js` (2 new tests), `docs/DEMO_SCRIPT.md`. Tested: `FALKORDB_PORT=6380 npm test` (64/64 pass, none skipped) against FalkorDB
  (falkordblite module); Today, Practice briefing, Listening, My progress, a Library item and a full practice session checked in Chromium (Playwright):
  no graph labels, raw mastery, memory version or JSON in the page text, no console errors, no horizontal scroll at 390 px.

* **2026-10-18** · Plain-language learner UI: agent activity no longer shows raw JSON anywhere. The timeline (`timeline()` in `learning.js`, used on
  *My progress* and the session summary) now renders one sentence per step via the new `describeEvent()` in `utils.js` (agents labelled *Your tutor* /
  *Quiz builder* / *Progress tracker*, concept ids resolved to names, relative times); the Read/Changed/Output JSON is gone. Memory page renamed to
  *My progress* (nav too); Episodic/Semantic/Procedural cards are now *My study history* / *What I've learned* / *How I learn best*, with % known
  instead of raw mastery, friendly preference labels (`prefText`) and *You chose* / *We noticed* badges; status badges read *new* / *getting there* /
  *needs revision* / *strong*; graph explorer, Ask the tutor, toasts, session feedback and summary reworded. No API or server change (the `note`
  fields from `/api/learner/memory` are kept but no longer displayed). Files: `public/index.html`, `public/js/{utils,learning,memory,dashboard,graph}.js`,
  `tests/unit.test.js` (new plain-language test), `docs/DEMO_SCRIPT.md`, `docs/ARCHITECTURE.md`. Tested: `FALKORDB_PORT=6380 npm test` (62/62 pass,
  none skipped) against FalkorDB (falkordblite module); full practice session driven in Chromium via Playwright, *My progress* and session summary
  checked at 1366 px and 390 px: no `{`/`}` or `<code>` in the page, no console/CSP errors, no horizontal scroll.

* **2026-10-18** · Static frontend files are now served with `Cache-Control: public, max-age=0` (was `max-age=3600`) plus ETag, so browsers
  revalidate on every load (304 when unchanged) and a new deploy shows up immediately instead of after up to an hour. Files: `server/app.js`,
  `tests/api.test.js` (asserts `max-age=0` and an ETag on `/js/library.js`). Tested: `FALKORDB_PORT=6380 npm test` (61/61 pass, none skipped);
  `curl` with `If-None-Match` against a local server returns 304.

* **2026-10-18** · Removed the developer hint "npm run ingest" from the four learner-facing messages (empty library list, empty listening page,
  kanji detail without stroke-order file, stroke-order tab without files); visitors on the hosted app can't run it, and the empty library list is
  usually caused by an active topic filter, not missing data. Topic filter behaviour unchanged. Files: `public/js/library.js`, `public/js/listening.js`.
  Tested: `FALKORDB_PORT=6380 npm test` (61/61 pass, none skipped) against FalkorDB in Docker; checked `#/library?tab=vocabulary&topic=hiragana` in
  headless Chromium (shows "Nothing here yet.", no console errors).

* **2026-10-18** · Sign in with Google (no password) + guest accounts; boot no longer gives up on the database. **Fix**: on Render the app had
  `FALKORDB_HOST=localhost`, so `boot()` failed after 60 s and every `/api` call answered 503 forever; `bootLoop()` now retries with 5–60 s backoff and logs a hint
  when the host is localhost on a hosting platform. **Google**: `/api/auth/google/start|callback` (authorization-code + PKCE + state + nonce, `fetch` only, no new
  dependency, no CSP change), accounts found by `googleSub`, else linked by verified email, else the caller's guest account is upgraded (same learner), else created.
  **Guest**: `POST /api/auth/guest` makes an `Account {kind:'guest'}` + own learner reachable only through its cookie (`GUEST_TTL_DAYS`, default 180, renewed
  while used); signing out deletes it; abandoned guests pruned on boot and daily. `GET /api/auth/options`; `/auth/me` gains `guest` (additive). Email + password
  endpoints answer 410 `password_auth_disabled` unless `PASSWORD_AUTH=1` (user's request: no passwords). `TRUST_PROXY=1` for Render (rate limit by real IP, https
  redirect URI). Schema v3: unique `Account.googleSub`, indexes `Account.kind`, `AuthSession.accountId` (additive). Frontend: sign-in page with *Continue with Google* /
  *Continue as guest*, guest banner, *Save with Google*, guest sign-out confirmation. Files: `server/index.js`, `server/config.js`, `server/app.js`,
  `server/services/auth.js`, `server/services/google.js` (new), `server/graph/memory.js`, `server/graph/schema.js`, `public/js/auth.js`, `public/js/app.js`,
  `public/js/api.js`, `public/css/components.css`, `tests/auth.test.js` (new), `tests/unit.test.js`, `tests/api.test.js`, `.env.example`, `docker-compose.yml`,
  `README.md`, `docs/ARCHITECTURE.md`, `docs/PRD.md`. Tested: `npm test` → 61/61 pass against FalkorDB (falkordblite module), Google's token endpoint faked;
  boot retry checked by starting the app with no database, then starting FalkorDB (it became ready without a restart); guest flow checked in headless Chromium
  at 393 px. Not tested against real Google (no client credentials in the sandbox).

* **2026-10-18** · Optional TLS / ACL user for the FalkorDB connection (for hosted databases such as FalkorDB Cloud): `FALKORDB_TLS=1` sets `socket.tls`,
  `FALKORDB_USERNAME` sets the ACL user; both default to off/empty so the Compose/local setup is unchanged. Files: `server/config.js`, `server/graph/client.js`,
  `.env.example`, `docker-compose.yml`, `README.md`, `tests/unit.test.js`. Tested: `npm test` → 50/50 pass against FalkorDB (falkordblite module); a manual
  connect through a Node TLS-terminating proxy with a self-signed cert succeeded with `tls: true` (verified via `NODE_EXTRA_CA_CERTS`). Not tested against FalkorDB Cloud itself.
* **2026-10-18** · Docs: audited `docs/ARCHITECTURE.md` against the code and corrected it (missing endpoints, `Meta` node, Exercise/Attempt
  properties, Examiner contrast-partner rule, prerequisite rule only for grammar, `affinity:*` threshold, pace multipliers, reset behaviour, CSP images,
  service layer in the diagram); added *Tech stack*, *Folder structure*, *API flow* (request pipeline, endpoint table, frontend flow), *Database* and
  *Ingestion* sections. Added `docs/MEMORY.md` (this file), `docs/RULES.md`, root `CLAUDE.md`/`AGENTS.md` pointers, README links and missing
  endpoints in the README API list. No code changes. Tested: `npm test` → 49/49 pass against FalkorDB (falkordblite module).
* **2026-10-18** · Product requirements document `docs/PRD.md` added.
* **2026-10-18** · Learner accounts (sign-up/sign-in/sign-out, per-account learner, isolation checks, rate limit, cross-site write check); the shared
  `learner:me` profile was removed. Tests for accounts and isolation added.
* **2026-10-18** · README: FalkorDB start order, later runs and recovery after bootstrap gives up.
* **2026-10-17** · Beginner learning path (`pathway.js`); new material in revision sessions taken from the path.
* **2026-10-17** · Ingestion of local JLPT N5 resources (grammar CSV, PDF study lists, stroke-order pages) and fixes to its inconsistencies.
* **2026-10-17** · Default host ports 6380 (FalkorDB) / 3002 (app).
* **2026-10-17** · Initial app: graph schema, ingestion, three agents, listening, memory explorer, demo seed, Docker setup, tests.
