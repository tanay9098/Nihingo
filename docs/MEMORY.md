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
* Every agent step logs an `AgentEvent` (`server/agents/events.js`); the UI timeline only reads them.
* Client-supplied ids (`sessionId`, `attemptId`, `logId`) are idempotent for the owner and refused (403/404/409) for anyone else.
* Demo mode is the default and must keep working without any LLM key.

## Change log

Newest first. One entry per change: date · summary · files · how it was tested.

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
