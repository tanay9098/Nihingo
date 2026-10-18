# Architecture

> Companion docs: [`MEMORY.md`](MEMORY.md) (project context + change log for the next developer / AI tool) ·
> [`RULES.md`](RULES.md) (rules every change must follow) · [`PRD.md`](PRD.md) (product requirements).

## Tech stack

| Layer | Technology | Notes |
| --- | --- | --- |
| Frontend | Plain HTML + CSS + vanilla JavaScript ES modules (`public/`) | No framework, no bundler, no build step. Pages are lazy-loaded with dynamic `import()`. Graph view is hand-written SVG (`public/js/graph.js`). |
| Backend | Node.js ≥ 20 (developed on 22), ES modules (`"type": "module"`) | `.env` loaded natively with `process.loadEnvFile` (no `dotenv`). |
| HTTP framework | Express 5 (`express`) | The **only** web dependency. JSON bodies capped at 20 kB; security headers set by hand (no `helmet`). |
| Database | FalkorDB (Redis module, property graph, Cypher) via the official `falkordb` npm client | Persistent with AOF + Docker volume. Graph `nihongo`; optional sidecar graph `nihongo_rag`. |
| Auth | Built in (`node:crypto` + `fetch`): Google OAuth 2.0 authorization-code flow with PKCE, guest accounts, random 256-bit session tokens (SHA-256 stored); legacy scrypt password hashes | No passport/google-auth-library/bcrypt/jwt libraries, no Google script in the page. |
| LLM (optional, AI mode) | Anthropic Messages API or any OpenAI-compatible Chat Completions API, called with `fetch` | No SDK dependency. Without provider + key + model the app runs in deterministic **demo mode**. |
| Ingestion | Own RFC-4180 CSV parser, JSON/JSONL, PDFs via `pdftotext`/`pdfinfo` (`poppler-utils`, optional system tool) | No parsing libraries. |
| Optional sidecar | Python ≥ 3.10, `graphrag-sdk[litellm]`, `aiohttp` (`graphrag/`) | Only used in AI mode when `GRAPHRAG_URL` is set. |
| Tests | Node built-in test runner (`node --test`) + real FalkorDB for integration tests | No Jest/Mocha. |
| Ops | Dockerfile (`node:22-alpine`), `docker-compose.yml` (FalkorDB `v4.18.9` + app + optional `graphrag` profile) | |

Runtime npm dependencies are exactly two: `express` and `falkordb` (see `package.json`). There are no dev dependencies.

## Folder structure

```
.
├── server/                      Node backend (ES modules)
│   ├── index.js                 Entry point: starts HTTP server, connects to FalkorDB (60 retries), bootstraps
│   ├── app.js                   Express app: headers/CSP, cross-origin check, auth middleware, all /api routes, error envelope
│   ├── config.js                Env → config object; appMode() = 'ai' | 'demo'
│   ├── agents/
│   │   ├── tutor.js             Agent 1 — reads memory, recommends, explains (never writes learner memory)
│   │   ├── examiner.js          Agent 2 — selects exercises, grades answers (no memory writes)
│   │   ├── planner.js           Agent 3 — Memory & Planner: ALL learner-memory writes, decide() policy, preferences, per-learner lock
│   │   ├── grade.js             Pure answer-grading rules
│   │   ├── mastery.js           Pure mastery estimate (Wilson bound) + spaced-repetition scheduling
│   │   ├── pathway.js           Learning-path definition (6 steps) + buildPathway()
│   │   └── events.js            AgentLog → persisted AgentEvent nodes (the agent timeline)
│   ├── graph/
│   │   ├── client.js            GraphClient: one connection, parameterised query()/read()
│   │   ├── schema.js            Indexes + UNIQUE constraints (idempotent), SCHEMA_VERSION
│   │   ├── catalog.js           CatalogStore: concepts, exercises, resources, lessons, topics, search
│   │   └── memory.js            MemoryStore: learners, accounts, sessions, attempts, mistakes, STUDIES, prefs, recs, events
│   ├── services/
│   │   ├── learning.js          LearningService: orchestrates the 3 agents; dashboard/memory read models; graph explorer; HttpError
│   │   ├── auth.js              AuthService: Google + guest + legacy password sign-in, sign-out, session tokens
│   │   ├── google.js            GoogleAuth: OAuth consent URL (state, PKCE, nonce), code exchange, ID-token claim checks
│   │   ├── rag.js               RagService: graph retrieval for “Ask the Tutor” (+ optional sidecar / LLM)
│   │   └── llm.js               askJson() for Anthropic/OpenAI with validation + fallback; numbersSubset()
│   ├── ingestion/               resources/ → graph: files.js (discovery + handlers), mapping.js (column detection),
│   │                            records.js, csv.js, pdf-layouts.js, exercises.js (generation), ingest.js (pipeline),
│   │                            inventory.js (writes the table in docs/RESOURCE_INVENTORY.md)
│   └── seed/demo.js             Seeds the demo learner's history through the real Examiner/Planner code
├── public/                      Static frontend served by Express
│   ├── index.html               Shell + top bar
│   ├── css/styles.css, components.css
│   ├── assets/icons/favicon.svg
│   └── js/                      app.js (hash router), api.js (fetch wrapper, the only server access), utils.js (DOM helpers, textContent only),
│                                dashboard.js (Today), learning.js (Practice), library.js, listening.js, memory.js, graph.js (SVG), auth.js
├── scripts/                     CLI entry points used by npm scripts (init, ingest, seed:demo, catalog, demo:flow)
├── tests/                       unit.test.js (pure functions), ingestion.test.js, workflow.test.js, api.test.js, helpers.js, fixtures/
├── resources/                   Learning content: original/ (MIT), local/ (third-party files), external/ (Lazy Benkyou catalog), sources.json
├── graphrag/                    Optional Python GraphRAG-SDK sidecar (app.py, Dockerfile, requirements.txt)
├── docs/                        ARCHITECTURE.md, MEMORY.md, RULES.md, PRD.md, DEMO_SCRIPT.md, RESOURCE_INVENTORY.md
├── Dockerfile, docker-compose.yml, .env.example, package.json
└── CLAUDE.md / AGENTS.md        Pointers for AI coding tools → docs/RULES.md and docs/MEMORY.md
```

## System overview

```
Browser (HTML + CSS + vanilla JS modules)            no DB access, no secrets
   │  fetch() JSON  (HttpOnly session cookie → the account's own learner; guests get learner:demo)
   ▼
Express app  server/app.js   headers/CSP · cross-site write check · auth middleware · validation · {ok,data|error} envelopes · static files
   │
   ├── AuthService      server/services/auth.js      accounts, scrypt hashes, sign-in sessions
   ├── RagService       server/services/rag.js       “Ask the Tutor” (graph retrieval; optional LLM / GraphRAG-SDK sidecar)
   ├── CatalogStore     server/graph/catalog.js      library, resources, listening catalog (read directly by some routes)
   └── LearningService  server/services/learning.js  orchestrates the agents + read models (dashboard, memory, graph explorer)
          ├── TutorAgent      server/agents/tutor.js        reads memory, recommends, explains
          ├── ExaminerAgent   server/agents/examiner.js     selects exercises, grades answers (no memory writes)
          └── PlannerAgent    server/agents/planner.js      ALL learner-memory writes + next-step planning
                 │ share state ONLY through the graph
                 ▼
CatalogStore / MemoryStore  server/graph/*.js        parameterised Cypher via falkordb (npm) → GraphClient (client.js)
                 ▼
FalkorDB  (persistent: AOF + volume)                 optional: GraphRAG-SDK sidecar → separate graph "nihongo_rag"

Ingestion (boot or `npm run ingest`): resources/ → server/ingestion/* → CatalogStore (MERGE, idempotent, checksummed)
```

### Boot sequence (`server/index.js`)

1. The HTTP server starts listening immediately; until the DB is ready `/api/health` returns 503 and other `/api` routes return `db_unavailable`.
2. `GraphClient.connect()` tries 10 × 1 s; if that or any later step fails, `bootLoop()` logs `Bootstrap failed (attempt n): …`, keeps the error for
   `/api/health`, waits 5–60 s (growing) and starts over, for as long as the process runs. A late database is therefore picked up without a restart.
   With `FALKORDB_HOST=localhost` on a hosting platform (`RENDER` or `NODE_ENV=production`) the log also says that the database must be configured.
3. `ensureSchema()` creates indexes/constraints (idempotent).
4. If `AUTO_BOOTSTRAP` ≠ `0`: ingest `resources/`, ensure the demo learner (and delete the legacy `learner:me`), seed the demo history if it has none.
   Otherwise only the learners are ensured.
5. Expired `AuthSession`s and guest accounts left without any sign-in are pruned (again once a day); the service objects are published and the app reports `Ready. Mode: …`.

## API flow

### Request pipeline (`server/app.js`)

```
request → security headers (CSP, nosniff, Referrer-Policy) → express.json (20 kB)
        → /api router: Cache-Control: no-store
        → cross-site write check (POST etc. with a foreign Origin → 403 cross_origin)
        → GET /api/health (answers even while the DB is down)
        → identity middleware: services ready? (else 503) · nh_session cookie → AuthService.resolve() → req.auth
                               expired/unknown cookie → cleared, 401 session_expired (except /auth/*)
                               guest sign-in past half its lifetime → extended, cookie re-sent
                               X-Learner-Id: only "learner:demo" or the caller's own learner (else 401/403)
                               req.learnerId = X-Learner-Id || own learner || "learner:demo"
        → route handler: validate inputs (str/id/int helpers) → service/store call → ok(res, data)
        → error handler: HttpError → {ok:false,error:{code,message}}; bad JSON 400; too large 413; DB errors 503; else 500
```

Every response is `{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message" } }`. Unknown `/api/*` paths → 404 `not_found`.
Everything else is served from `public/` (static, 1 h cache).

### Endpoints

| Method & path | Handler | Notes |
| --- | --- | --- |
| `GET /api/health` | app.js | Mode, DB latency, counts, bootstrap info; 503 while starting |
| `GET /api/auth/me` | app.js `meView` | `{signedIn:false, learner}` without an account; else `{signedIn:true, guest, email? (not for guests), learner}` |
| `GET /api/auth/options` | app.js | `{google, guest, password}`: which sign-in methods this server offers |
| `GET /api/auth/google/start` | `GoogleAuth.start` | Browser navigation: sets the `nh_oauth` cookie (state, PKCE verifier, nonce; 10 min) and 303-redirects to Google. Not configured → `/#/signin?error=google_disabled` |
| `GET /api/auth/google/callback` | `GoogleAuth.finish` + `AuthService.signInWithGoogle` | Checks `state`, exchanges the code, sets `nh_session`, 303 → `/#/?signedin=google` (`&guest=left` if a guest signed in to an existing account). Errors → `/#/signin?error=<code>` (`google_state`, `google_cancelled`, `google_unverified`, `google_failed`, `email_taken`, `rate_limited`); rate-limited |
| `POST /api/auth/guest` | `AuthService.startGuest` | New guest account + learner → 201 + cookie (`GUEST_TTL_DAYS`); with an account already, returns it unchanged; rate-limited |
| `POST /api/auth/signup` | `AuthService.signUp` | Legacy, only with `PASSWORD_AUTH=1` (else 410 `password_auth_disabled`). `{email, password (≥ 8), name?}` → 201 + cookie; 409 `email_taken`; rate-limited |
| `POST /api/auth/signin` | `AuthService.signIn` | Legacy, only with `PASSWORD_AUTH=1` (else 410). 401 `bad_credentials` (same for unknown email); rate-limited |
| `POST /api/auth/signout` | `AuthService.signOut` | Deletes the session server-side, clears the cookie; for a guest it deletes the whole guest account and its learner |
| `GET /api/dashboard` | `LearningService.dashboard` | Today page: plan, pathway, progress, due, mistakes, listening pick |
| `GET /api/library?q&kind&topic&limit&offset` | `CatalogStore.search` | `kind` ∈ vocabulary/kanji/kana/grammar |
| `GET /api/library/item?id=` | `CatalogStore.getConcept` + learner's `STUDIES` state | 404 if unknown |
| `GET /api/library/exercises` | `CatalogStore.exerciseSummary` | Original vs generated exercises |
| `GET /api/library/topics` | `CatalogStore.topics` | |
| `GET /api/library/stroke-references` | `CatalogStore.strokeReferences` | `REFERENCES` pages for kanji/kana |
| `GET /api/resources[/:id]` | `CatalogStore.listResources / getResource` | Provenance of every file |
| `GET /api/listening` | `CatalogStore.listLessons` + `MemoryStore.listeningLogs` | |
| `POST /api/listening/:lessonId/log` | `MemoryStore.logListening` | `{rating 1–5, note?, logId?}`; 409 if `logId` belongs to another learner; bumps `memoryVersion` |
| `POST /api/listening/:lessonId/save` | `MemoryStore.setSaved` | `{saved: bool}` |
| `GET /api/learner/memory` | `LearningService.memoryView` | Episodic / semantic / procedural views |
| `GET /api/learner/sessions?limit` | `MemoryStore.recentSessions` | |
| `POST /api/learner/reset` | demo → `seedDemo`; account → `LearningService.resetLearner` | Needs `{confirm: true}` |
| `POST /api/sessions` | `LearningService.startSession` | Optional client `sessionId`; 403 if it belongs to another learner; 201 |
| `GET /api/sessions/:id` | `LearningService.sessionView` | Resume a session; 404 for another learner's session |
| `GET /api/sessions/:sid/reveal/:exerciseId` | app.js | Flashcard back only, only for exercises in the caller's own session |
| `POST /api/attempts` | `LearningService.answer` | `{sessionId, exerciseId, attemptId?, answer, ms?}`; idempotent on `attemptId` |
| `POST /api/sessions/:id/complete` | `LearningService.complete` | Summary, mastery changes, next briefing |
| `GET /api/recommendations` | `TutorAgent.brief` | |
| `GET /api/agents/timeline?limit&sessionId` | `MemoryStore.events` | Persisted `AgentEvent`s |
| `GET /api/graph/neighborhood?center&depth&limit&all&sources` | `LearningService.neighborhood` | depth ≤ 2, limit 5–80; hides other learners and account data; `sources=0` also hides source files (`Resource`) |
| `POST /api/feedback` | `PlannerAgent.setPreference / clearPreference`, `MemoryStore.upsertPreference` | `type` ∈ preference / clear_preference / exercise_feedback |
| `POST /api/tutor/ask` | `RagService.ask` | `{question ≤ 200 chars}` |

### Frontend flow

`public/js/app.js` is a hash router (`#/`, `#/practice`, `#/library`, `#/listening`, `#/memory`, `#/signin`, `#/signup`) that lazy-imports one
page module per route and discards a slower earlier render if the user has already navigated on (`renderToken`). All requests go through
`public/js/api.js` (`fetch`, 15 s timeout, `ApiError`). Whenever the demo learner is being viewed (always for guests; by choice for a signed-in user,
remembered in `localStorage`), `api.js` sends `X-Learner-Id: learner:demo`. All dynamic text is rendered with `textContent` (`utils.js`), never `innerHTML`.

## Database

FalkorDB is the only datastore: there are no SQL databases, caches or files written at runtime (apart from `docs/RESOURCE_INVENTORY.md` by `npm run ingest`).
Connection settings come only from server env (`FALKORDB_HOST/PORT/USERNAME/PASSWORD/TLS/GRAPH`; `FALKORDB_TLS=1` encrypts the connection, `FALKORDB_QUERY_TIMEOUT_MS` default 8000 ms).
Writes use `GraphClient.query()`, reads may use `GraphClient.read()` (`roQuery`). Persistence in Docker: AOF (`appendfsync everysec`) on the `falkordb_data` volume.

### Why a graph is essential here

* **Recurring mistakes** are found by traversing `Mistake -[:ABOUT]-> Concept` and counting distinct `LearningSession`s.
* **Prerequisite gaps**: `(Concept)-[:REQUIRES]->(Concept)` joined with the learner's `STUDIES` edge decides whether to revise the prerequisite first.
* **Confusable pairs**: `CONTRASTS_WITH` makes the Examiner mix に/で together and lets the Planner switch to side-by-side revision when both are missed.
* **Listening links**: `Concept -[:TAGGED]-> Topic <-[:TAGGED]- Lesson` (topics come from the video *title* only) explains why a lesson is suggested.
* **Evidence**: each `Recommendation` has `BASED_ON` edges to the `Mistake`/`ListeningLog` nodes that caused it and `RECOMMENDS` edges to its targets, so “why?” is a graph query, not a guess.

### Graph schema (graph `nihongo`)

| Node | Key properties | Notes |
| --- | --- | --- |
| `Concept:Vocabulary / :Kanji / :Kana / :GrammarConcept` | `id`, `search`, content fields, `order`, `tags`, `primarySource` | Two labels so generic queries use `Concept`. Ids are stable (`v:水`, `k:日`, `kana:あ`, `g-ni`; grammar from spreadsheets uses `g:<grammar point>`). `primarySource` is the Resource that defined the concept: later files only fill its empty fields (never `level`). Concepts from non-original files get `order` + 100000 (`LOCAL_ORDER`) so curated content is planned first. |
| `Exercise` | `type`, `format`, `prompt`, `answer`, `choices`, `checker`, `accept`, `alsoValid`, `origin` (`original` \| `generated-from-source`) | Answers stay server-side. |
| `Resource` | `path`, `checksum`, `format`, `status`, `source`, `license`, `url` | One per file; provenance preserved. |
| `Lesson` | `videoId`, `url`, `embedUrl`, `difficulty`, `difficultyEvidence`, `embeddable` | Listening catalog (Lazy Benkyou). |
| `Topic` | `name` | Shared tag for concepts and lessons. |
| `Learner` | `name`, `isDemo`, `memoryVersion` | `memoryVersion` is bumped on every memory write; recommendations record the version they were computed from. |
| `Account` | `kind` (`google` \| `guest`; none = legacy password account), `email` (unique), `googleSub` (unique), `passwordHash` (scrypt, legacy only), `profileId` | Owns exactly one `Learner` (`profileId` = `learner:<uuid>`, generated by the server). A guest account has neither email nor `googleSub`; signing in with Google turns it into a `google` account with the same learner. Never shown in the graph explorer. |
| `AuthSession` | `accountId`, `profileId`, `expiresAt` | A sign-in. `id` is the SHA-256 of the cookie token; the token itself is never stored. |
| `LearningSession` | `startedAt`, `status` (`planning` → `completed`), `score`, `isDemo`, `focus`, `mode` | Episodic. |
| `Attempt` | `correct`, `ambiguous`, `quality`, `answer`, `expected`, `format`, `masteryBefore/After`, `statusAfter`, `isDemo` | Episodic; id supplied by the client → idempotent for the same learner; an id another learner already used is refused (409). |
| `Mistake` | `given`, `expected`, `prompt`, `isDemo` | One per wrong attempt (`id` = `mistake:<attemptId>`). |
| `ListeningLog` | `rating (1–5)`, `note`, `isDemo` | Self-reported comprehension. Id may come from the client: idempotent for the same learner, refused (409) if another learner owns it. |
| `LearningPreference` | `key`, `value`, `source` (`explicit` \| `inferred`), `evidenceCount`, `evidence` | Procedural. |
| `Recommendation` | `role` (`study` \| `listen`), `activity`, `reason`, `evidence` (JSON, incl. `stage`: the learner's learning-path step), `stateVersion`, `status` | Old ones become `superseded`, not deleted. |
| `AgentEvent` | `agent`, `action`, `retrieved`, `changed`, `output`, `at`, `seq` | The real timeline; never synthesised. |
| `Meta` | `id = 'schema'`, `schemaVersion`, `updatedAt` | Written by `ensureSchema()`. Not indexed; hidden from the graph explorer. |

Episodic and learner-owned nodes carry a `learnerId` property; that is what learner isolation and “reset progress” key on.

| Relationship | Meaning |
| --- | --- |
| `(Learner)-[:STUDIES {attempts, correct, mistakes, recent, mastery, status, intervalDays, ease, dueAt, lastSeen}]->(Concept)` | **One** semantic-memory edge per learner/concept. `status` ∈ new/learning/struggling/mastered replaces separate `MASTERED`/`STRUGGLES_WITH` edges (avoids redundancy). |
| `(Learner)-[:PARTICIPATED_IN]->(LearningSession)-[:INCLUDES]->(Attempt)-[:OF]->(Exercise)`; `(Learner)-[:ATTEMPTED]->(Attempt)`; `(LearningSession)-[:SELECTED {position, reason}]->(Exercise)` | Episodic memory |
| `(Attempt)-[:TESTED]->(Concept)`; `(Attempt)-[:RESULTED_IN]->(Mistake)-[:ABOUT]->(Concept)` | Evidence trail |
| `(Exercise)-[:TESTS]->(Concept)` | |
| `(Concept)-[:REQUIRES]->(Concept)`, `(Concept)-[:CONTRASTS_WITH]->(Concept)`, `(Kanji)-[:APPEARS_IN]->(Vocabulary)` | Authoritative language structure (from the data files) |
| `(Resource)-[:CONTAINS / :EXPLAINS / :REFERENCES {loc, page, flags}]->(…)` | Provenance with row/page. `CONTAINS` → concepts, exercises and lessons; `EXPLAINS` → grammar concepts; `REFERENCES` points from a stroke-order PDF/image to a `Kanji` or `Kana`, with the page |
| `(Concept\|Lesson)-[:TAGGED]->(Topic)` | |
| `(Learner)-[:PREFERS]->(LearningPreference)`; `(Learner)-[:HAS_RECOMMENDATION]->(Recommendation)`; `(Recommendation)-[:RECOMMENDS]->(Concept\|Lesson)`; `(Recommendation)-[:BASED_ON]->(Mistake\|ListeningLog)` | |
| `(Learner)-[:WATCHED]->(ListeningLog)-[:OF]->(Lesson)`; `(Learner)-[:SAVED {at}]->(Lesson)` | Listening history |
| `(Learner)-[:HAS_EVENT]->(AgentEvent)`; `(LearningSession)-[:LOGGED]->(AgentEvent)`; `(AgentEvent)-[:HANDED_OFF_TO]->(AgentEvent)` | Agent timeline |

Indexes: a range index on `id` for every label in `ID_LABELS` (all node labels above except `Meta`) plus `learnerId` on `Attempt`, `Mistake`,
`AgentEvent` and `LearningSession`, and a UNIQUE constraint on `id`; `Account.email` and `Account.googleSub` also have a range index and a UNIQUE constraint, so two accounts
can never share an email or a Google identity even under concurrent sign-ins (nodes without the property, e.g. guests, are not constrained); `Account.kind` and
`AuthSession.accountId` are indexed for guest pruning (`server/graph/schema.js`, idempotent; `SCHEMA_VERSION` 3). Search uses a precomputed
lower-case `search` property (word, hiragana reading, romaji, English, tags) so Japanese, kana, romaji and English queries all work with a parameterised `CONTAINS`.
Because FalkorDB properties can only be primitives/arrays, structured values (choices, evidence) are stored as JSON strings.

### Ingestion (`server/ingestion/`)

`scan resources/ → checksum → inspect (mapping.js detects columns/keys) → parse (csv.js, JSON/JSONL, pdftotext + pdf-layouts.js) → records.js → exercises.js → CatalogStore MERGE`.
Files are processed CSV/TSV first, then JSON, JSONL, other, PDFs last. A file whose checksum is unchanged (and whose last ingestion did not error) is skipped unless `--force`.
Unsupported or broken files are recorded as `Resource` nodes with a status and notes; they never abort ingestion. Provenance/licence per file comes from `resources/sources.json`.

## Agent coordination (the Track-2 workflow)

The agents never call each other with data; they hand off **ids** and re-read the graph.

1. `POST /api/sessions` → creates a `LearningSession` (`status: 'planning'`).
2. **Tutor** reads the learner's recurring mistakes, preferences and stored `Recommendation`; if the recommendation's `stateVersion`
   ≠ `Learner.memoryVersion` it hands off to the **Planner** to re-plan. It then retrieves the concept cards + source resources and
   writes the explanation (deterministic template in demo mode; LLM-reworded but number-checked in AI mode).
3. **Examiner** chooses N exercises (N = `session_length` preference): targeted slots (≥ 2, ~60 % of N) for the focus concepts — for
   `revise_concept` it also adds the focus's `CONTRASTS_WITH` partner (a `contrast_revision` already has both in its focus) — then other overdue items,
   then new material from the learner's current learning-path step (in a `new_material` session there are no targeted slots and the step's next items
   are picked round-robin over the step's next N items), then top-ups spread over the focus concepts. A session never shows the same prompt twice
   (several exercises of one concept share a prompt) unless it can't otherwise be filled. Format follows explicit > inferred preference;
   recently-seen exercises are de-prioritised (above an inferred format, below an explicit one). Writes `SELECTED` edges.
4. Learner answers → `POST /api/attempts` (client-generated `attemptId`).
5. **Examiner** grades it with explicit rules (`server/agents/grade.js`): exact choice; kana-normalised typed answers (katakana→hiragana,
   romaji accepted where listed); meaning recall with variants and a 1-edit typo tolerance (answers ≥ 5 characters) **flagged as ambiguous**;
   `also_valid` answers (e.g. へ for に) counted correct but flagged; flashcards are self-rated 1–4 (≥ 2 counts as correct). It performs no memory writes.
6. **Planner** (serialised per learner by an in-process mutex; idempotent on `attemptId`) writes `Attempt`, `Mistake`, updates the `STUDIES` edge, bumps `memoryVersion`.
7. `POST /api/sessions/:id/complete` → Planner closes the session, updates procedural memory, writes new `Recommendation` nodes.
8. The next Tutor request reads that state and produces a different, more targeted recommendation.

Every step writes an `AgentEvent` containing what it read, what it changed and what it produced — the UI timeline reads these nodes and words each one as plain sentences (`describeEvent` in `public/js/utils.js`); raw event data is never shown in the UI.

## Memory types

| Type | Where | Used for |
| --- | --- | --- |
| Episodic | `LearningSession`, `Attempt`, `Mistake`, `ListeningLog`, `AgentEvent` | Recurring-mistake detection, evidence, timeline |
| Semantic | `STUDIES` edges (estimated mastery), concept graph, recommendations | What to revise / learn next. Mastery is an *estimate of the learner*, not a fact about Japanese. |
| Procedural | `LearningPreference`; the learning path (`server/agents/pathway.js`) | The recommended order of study (path steps, computed from `STUDIES` edges, never stored separately). Explicit: session length (3/5/8), format, listening on/off, revision pace (`fast` ×0.6, `normal` ×1, `slow` ×1.5 on review intervals), last difficulty feedback. Inferred: per-format accuracy (`affinity:*`, once a format has ≥ 3 attempts) and `inferred_format` only when a format has ≥ 4 attempts and beats the others by ≥ 20 points. Learners can override or delete any of it. |

**Mastery** = lower bound of a Wilson score interval (z = 1.28) on correct/attempts, multiplied by 0.6 after a miss; `mastered` needs ≥ 4
attempts, mastery ≥ 0.6 and the last two answers right; `struggling` needs ≥ 2 misses among the last 6 answers including one of the last 3.
**Scheduling**: a correct answer sets the next due time to `interval × pace` (interval starts at 1 day and grows by the edge's `ease`, 1.3–2.8); a miss is due immediately.

## Recommendation policy (`decide()` in `planner.js`, unit-tested)

1. A concept with ≥ 2 mistakes that has not recovered (last two answers not both right, not `mastered`); struggling concepts first, then most mistakes:
   for a **grammar** concept with a weak prerequisite (unpractised or mastery < 0.35) → `revise_prerequisite`; a confusable partner that is itself an
   open recurring mistake → `contrast_revision`; else `revise_concept`.
2. A low (≤ 2) listening rating whose lesson topic links to concepts with mastery < 0.6 → `topic_revision`.
3. Overdue items → `review_due`.
4. Otherwise `new_material`: the next unstudied items of the learner's current **learning-path step** (`server/agents/pathway.js`: Hiragana → Katakana → First words → Sentence patterns (grammar, in `REQUIRES` order) → First kanji → JLPT N5 extension). A step is current until every item in it has a `STUDIES` edge; the last step keeps the original mix (next grammar whose prerequisites have been practised; next unstudied vocabulary). The path is computed from the existing graph, so stored progress is never reset.

A secondary **listening** recommendation is added unless the learner turned it off: the unwatched lesson sharing the most `Topic`s with the focus
(falls back to the newest unwatched, and says so). Explanations quote only numbers stored in the recommendation's evidence.

## Demo vs real data

Seeded history (`server/seed/demo.js`) is produced by the same Examiner/Planner code with historical timestamps and every node carries
`isDemo: true`; the UI badges it “demo data”. The demo learner `learner:demo` is open to guests and separate from every account's learner. Activity
created at demo time is `isDemo: false`. “Restore seeded demo” deletes every node with `learnerId = learner:demo` plus the learner's `STUDIES`/`SAVED`
edges, resets `memoryVersion` to 0 and re-seeds. “Delete my progress” on an account does the same reset without re-seeding.

## Accounts and learner isolation

Creating an account (`server/services/auth.js`: first Google sign-in or *Continue as guest*) creates an `Account` and a new `Learner` with a server-generated id in one query, so each account has its own
learning path and memory from the first request. A Google sign-in finds the account by `googleSub`, else by the same verified email (linking a legacy password
account), else upgrades the caller's guest account (same learner, so the guest's progress is kept), else creates a new one. A guest signing in to an account that
already existed leaves the guest account behind, and it is deleted (its cookie is replaced). The session is an HttpOnly, SameSite=Lax cookie (`nh_session`); the server resolves it to the
learner id on every request and never takes the learner from the client. `X-Learner-Id` may only switch a signed-in user to the demo learner;
any other value is refused (401 without an account, 403 with one). Without a cookie the visitor sees `learner:demo`.
`Account`/`AuthSession` link to their learner through `profileId` rather than `learnerId`, so resetting a learner's progress keeps the account.

Ids sent by the browser are checked against the owner: sessions and their timelines (404/403), attempt ids and listening-log ids already used
by another learner (409). The graph explorer refuses to centre on another learner, anything they own, or account data, and filters those out of
every neighbourhood. Sign-in and guest creation are rate-limited per IP (in-process), and writes whose `Origin` names another site are rejected.

## GraphRAG

* Always on (both modes): `RagService` retrieves concepts matching the question (scored exact/partial), expands each to its graph neighbours and source
  resources, and answers from those passages; with no match it says it doesn't know.
* AI mode: answers are LLM-written from the numbered passages only, with a figure-consistency check, falling back to the retrieved text on any failure.
* Optional: the official **GraphRAG-SDK** (Python ≥ 3.10) in `graphrag/` (aiohttp service: `GET /health`, `POST /ingest`, `POST /ask` on port 8010).
  It needs an LLM *and* an embedding model, so it is a separate service used only when `GRAPHRAG_URL` is set in AI mode; it ingests grammar/vocabulary
  documents into its own graph: everything in `resources/original/` plus grammar spreadsheets in `resources/local/` (not the PDFs). See `graphrag/README.md`.
  It was verified against the SDK's real signatures and a live FalkorDB connection, but **not** end-to-end with an LLM (no key was available).

## Security notes

Browser ↔ `/api` only; the DB password and LLM key exist only in server env. All Cypher is parameterised (labels/relationship types are interpolated only from
whitelists). Inputs are length/format-validated, JSON bodies capped at 20 kB, CSP restricts scripts/styles to `self`, images to `self` + `i.ytimg.com`
and frames to YouTube.

Accounts (see *Accounts and learner isolation*):
* Google sign-in is the server-side authorization-code flow with PKCE (S256), a random `state` (CSRF) and `nonce`, kept in the HttpOnly `nh_oauth` cookie (path
  `/api/auth/google`, 10 min). The ID token comes directly from Google's token endpoint over TLS in exchange for the client secret, so its signature is not
  re-checked; `iss`, `aud` (= client id), `exp`, `nonce` and `email_verified` are. `GOOGLE_CLIENT_SECRET` exists only in server env.
* A guest account's only credential is its `nh_session` cookie; it lasts `GUEST_TTL_DAYS` (default 180), is extended while used, and is deleted on sign-out or once
  no sign-in for it remains.
* Legacy (only with `PASSWORD_AUTH=1`): passwords (≥ 8 characters) are stored only as salted scrypt hashes (`scrypt$N$r$p$salt$hash`) and never returned; a wrong password and an unknown email give the
  same `401` and take the same work, so sign-in does not reveal which emails are registered (sign-up does answer `409` for a taken email).
* The session cookie `nh_session` is a random 256-bit token, `HttpOnly` and `SameSite=Lax`; only its SHA-256 is stored, so a database dump holds no
  usable tokens. `Secure` is added with `COOKIE_SECURE=1`, which must be set whenever the app is served over HTTPS. Sign-ins expire after
  `SESSION_TTL_DAYS` (default 30); expired ones are deleted on use and on boot. Sign-out deletes the session server-side.
* Writes whose `Origin` names another site are rejected (403) on top of `SameSite=Lax`.
* Sign-in and guest creation are limited to 20 attempts per 10 minutes per client IP, counted in-process (reset on restart, not shared between instances).
  Behind a reverse proxy set `TRUST_PROXY=1` (Express `trust proxy` = 1 hop), or every user shares the proxy's IP and therefore one limit.
* Not implemented: account deletion for Google accounts, multi-factor sign-in (left to Google).
