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
* **Accounts**: email + password (`server/services/auth.js`), HttpOnly cookie `nh_session`; each account owns one `Learner`
  (`learner:<uuid>`); guests use `learner:demo` (seeded, `isDemo: true`).
* **Learning path**: Hiragana → Katakana → First words → Sentence patterns → First kanji → JLPT N5 extension (`pathway.js`), computed from `STUDIES` edges.
* **Content**: `resources/original/` (MIT, curated), `resources/local/` (third-party JLPT N5 PDFs/CSV), `resources/external/lazybenkyou_videos.json` (15 videos).
* **Tests**: 49 (22 unit + 27 integration) in `tests/`, all passing on 2026-10-18 against a real FalkorDB module. Run with `FALKORDB_PORT=<port> npm test`.
* **Not implemented / known gaps**: email verification, password reset, account deletion, MFA; rate limit and per-learner lock are in-process
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
