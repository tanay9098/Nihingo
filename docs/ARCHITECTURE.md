# Architecture

```
Browser (HTML + CSS + vanilla JS modules)            no DB access, no secrets
   │  fetch() JSON  (header X-Learner-Id: learner:demo | learner:me)
   ▼
Express app  server/app.js   validation · CSP · consistent {ok,data|error} envelopes · static files
   │
   ▼
LearningService  server/services/learning.js        orchestrates the agents
   ├── TutorAgent      server/agents/tutor.js        reads memory, recommends, explains
   ├── ExaminerAgent   server/agents/examiner.js     selects exercises, grades answers (no memory writes)
   └── PlannerAgent    server/agents/planner.js      ALL learner-memory writes + next-step planning
          │ share state ONLY through the graph
          ▼
CatalogStore / MemoryStore  server/graph/*.js        parameterised Cypher via falkordb (npm)
          ▼
FalkorDB  (persistent: AOF + volume)                 optional: GraphRAG-SDK sidecar → separate graph "nihongo_rag"
```

## Why a graph is essential here

* **Recurring mistakes** are found by traversing `Mistake -[:ABOUT]-> Concept` and counting distinct `LearningSession`s.
* **Prerequisite gaps**: `(Concept)-[:REQUIRES]->(Concept)` joined with the learner's `STUDIES` edge decides whether to revise the prerequisite first.
* **Confusable pairs**: `CONTRASTS_WITH` makes the Examiner mix に/で together and lets the Planner switch to side-by-side revision when both are missed.
* **Listening links**: `Concept -[:TAGGED]-> Topic <-[:TAGGED]- Lesson` (topics come from the video *title* only) explains why a lesson is suggested.
* **Evidence**: each `Recommendation` has `BASED_ON` edges to the `Mistake`/`ListeningLog` nodes that caused it and `RECOMMENDS` edges to its targets, so “why?” is a graph query, not a guess.

## Graph schema (graph `nihongo`)

| Node | Key properties | Notes |
| --- | --- | --- |
| `Concept:Vocabulary / :Kanji / :Kana / :GrammarConcept` | `id`, `search`, content fields, `order`, `tags` | Two labels so generic queries use `Concept`. Ids are stable (`v:水`, `k:日`, `kana:あ`, `g-ni`). |
| `Exercise` | `type`, `format`, `prompt`, `answer`, `choices`, `origin` (`original` \| `generated-from-source`) | Answers stay server-side. |
| `Resource` | `path`, `checksum`, `format`, `status`, `source`, `license`, `url` | One per file; provenance preserved. |
| `Lesson` | `videoId`, `url`, `embedUrl`, `difficulty`, `difficultyEvidence`, `embeddable` | Listening catalog (Lazy Benkyou). |
| `Topic` | `name` | Shared tag for concepts and lessons. |
| `Learner` | `isDemo`, `memoryVersion` | `memoryVersion` is bumped on every memory write; recommendations record the version they were computed from. |
| `LearningSession` | `startedAt`, `status`, `score`, `isDemo`, `focus` | Episodic. |
| `Attempt` | `correct`, `ambiguous`, `answer`, `format`, `masteryBefore/After`, `isDemo` | Episodic; id supplied by the client → idempotent. |
| `Mistake` | `given`, `expected`, `prompt`, `isDemo` | One per wrong attempt. |
| `ListeningLog` | `rating (1–5)`, `note`, `isDemo` | Self-reported comprehension. |
| `LearningPreference` | `key`, `value`, `source` (`explicit` \| `inferred`), `evidenceCount`, `evidence` | Procedural. |
| `Recommendation` | `role` (`study` \| `listen`), `activity`, `reason`, `evidence` (JSON), `stateVersion`, `status` | Old ones become `superseded`, not deleted. |
| `AgentEvent` | `agent`, `action`, `retrieved`, `changed`, `output`, `at`, `seq` | The real timeline; never synthesised. |

| Relationship | Meaning |
| --- | --- |
| `(Learner)-[:STUDIES {attempts, correct, mistakes, recent, mastery, status, intervalDays, ease, dueAt, lastSeen}]->(Concept)` | **One** semantic-memory edge per learner/concept. `status` ∈ new/learning/struggling/mastered replaces separate `MASTERED`/`STRUGGLES_WITH` edges (avoids redundancy). |
| `(Learner)-[:PARTICIPATED_IN]->(LearningSession)-[:INCLUDES]->(Attempt)-[:OF]->(Exercise)`; `(Learner)-[:ATTEMPTED]->(Attempt)`; `(LearningSession)-[:SELECTED {position, reason}]->(Exercise)` | Episodic memory |
| `(Attempt)-[:TESTED]->(Concept)`; `(Attempt)-[:RESULTED_IN]->(Mistake)-[:ABOUT]->(Concept)` | Evidence trail |
| `(Exercise)-[:TESTS]->(Concept)` | |
| `(Concept)-[:REQUIRES]->(Concept)`, `(Concept)-[:CONTRASTS_WITH]->(Concept)`, `(Kanji)-[:APPEARS_IN]->(Vocabulary)` | Authoritative language structure (from the data files) |
| `(Resource)-[:CONTAINS / :EXPLAINS / :REFERENCES {loc, page, flags}]->(…)` | Provenance with row/page |
| `(Concept\|Lesson)-[:TAGGED]->(Topic)` | |
| `(Learner)-[:PREFERS]->(LearningPreference)`; `(Learner)-[:HAS_RECOMMENDATION]->(Recommendation)`; `(Recommendation)-[:RECOMMENDS]->(Concept\|Lesson)`; `(Recommendation)-[:BASED_ON]->(Mistake\|ListeningLog)` | |
| `(Learner)-[:WATCHED]->(ListeningLog)-[:OF]->(Lesson)`; `(Learner)-[:SAVED]->(Lesson)` | Listening history |
| `(Learner)-[:HAS_EVENT]->(AgentEvent)`; `(LearningSession)-[:LOGGED]->(AgentEvent)`; `(AgentEvent)-[:HANDED_OFF_TO]->(AgentEvent)` | Agent timeline |

Indexes: a range index on `id` for every label above plus `learnerId` on the large episodic labels, and a UNIQUE constraint on `id`
(`server/graph/schema.js`, idempotent). Search uses a precomputed lower-case `search` property (word, hiragana reading, romaji,
English, tags) so Japanese, kana, romaji and English queries all work with a parameterised `CONTAINS`.
Because FalkorDB properties can only be primitives/arrays, structured values (choices, evidence) are stored as JSON strings.

## Agent coordination (the Track-2 workflow)

The agents never call each other with data; they hand off **ids** and re-read the graph.

1. `POST /api/sessions` → creates a `LearningSession`.
2. **Tutor** reads the learner's recurring mistakes, preferences and stored `Recommendation`; if the recommendation's `stateVersion`
   ≠ `Learner.memoryVersion` it hands off to the **Planner** to re-plan. It then retrieves the concept cards + source resources and
   writes the explanation (deterministic template in demo mode; LLM-reworded but number-checked in AI mode).
3. **Examiner** chooses N exercises: targeted slots for the focus (plus its `CONTRASTS_WITH` partner), other overdue items, then new
   material; format follows explicit > inferred preference; recently-seen exercises are de-prioritised. Writes `SELECTED` edges.
4. Learner answers → `POST /api/attempts` (client-generated `attemptId`).
5. **Examiner** grades it with explicit rules (`server/agents/grade.js`): exact choice; kana-normalised typed answers (katakana→hiragana,
   romaji accepted); meaning recall with variants and a 1-edit typo tolerance **flagged as ambiguous**; `also_valid` answers (e.g. へ for に)
   counted correct but flagged. It performs no memory writes.
6. **Planner** (serialised per learner by a mutex; idempotent on `attemptId`) writes `Attempt`, `Mistake`, updates the `STUDIES` edge, bumps `memoryVersion`.
7. `POST /api/sessions/:id/complete` → Planner closes the session, updates procedural memory, writes new `Recommendation` nodes.
8. The next Tutor request reads that state and produces a different, more targeted recommendation.

Every step writes an `AgentEvent` containing what it read, what it changed and what it produced — the UI timeline is a plain read of these nodes.

## Memory types

| Type | Where | Used for |
| --- | --- | --- |
| Episodic | `LearningSession`, `Attempt`, `Mistake`, `ListeningLog`, `AgentEvent` | Recurring-mistake detection, evidence, timeline |
| Semantic | `STUDIES` edges (estimated mastery), concept graph, recommendations | What to revise / learn next. Mastery is an *estimate of the learner*, not a fact about Japanese. |
| Procedural | `LearningPreference` | Explicit: session length, format, listening on/off, revision pace (multiplies review intervals). Inferred: per-format accuracy (`affinity:*`) and `inferred_format` only when a format has ≥ 4 attempts and beats the others by ≥ 20 points. Learners can override or delete any of it. |

**Mastery** = lower bound of a Wilson score interval (z = 1.28) on correct/attempts, multiplied by 0.6 after a miss; `mastered` needs ≥ 4
attempts, mastery ≥ 0.6 and the last two answers right; `struggling` needs ≥ 2 misses among the last 6 answers including one of the last 3.
**Scheduling**: a correct answer sets the next due time to `interval × pace`; a miss is due immediately.

## Recommendation policy (`decide()` in `planner.js`, unit-tested)

1. A concept with ≥ 2 mistakes that has not recovered (last two answers not both right):
   weak prerequisite → `revise_prerequisite`; confusable partner also missed → `contrast_revision`; else `revise_concept`.
2. A low (≤ 2) listening rating whose lesson topic links to unmastered concepts → `topic_revision`.
3. Overdue items → `review_due`.
4. Otherwise `new_material` (next grammar whose prerequisites have been practised; next unstudied vocabulary).

A secondary **listening** recommendation is added unless the learner turned it off: the unwatched lesson sharing the most `Topic`s with the focus
(falls back to the newest unwatched, and says so). Explanations quote only numbers stored in the recommendation's evidence.

## Demo vs real data

Seeded history (`server/seed/demo.js`) is produced by the same Examiner/Planner code with historical timestamps and every node carries
`isDemo: true`; the UI badges it “demo data”. The demo learner `learner:demo` is separate from the empty personal profile `learner:me`. Activity
created at demo time is `isDemo: false`. “Restore seeded demo” deletes everything with `learnerId = learner:demo` and re-seeds.

## GraphRAG

* Always on (both modes): `RagService` retrieves concepts matching the question (scored exact/partial), expands each to its graph neighbours and source
  resources, and answers from those passages; with no match it says it doesn't know.
* AI mode: answers are LLM-written from the numbered passages only, with a figure-consistency check, falling back to the retrieved text on any failure.
* Optional: the official **GraphRAG-SDK** (Python ≥ 3.10) in `graphrag/`. It needs an LLM *and* an embedding model, so it is a separate service used only when
  `GRAPHRAG_URL` is set in AI mode; it ingests grammar/vocabulary documents into its own graph. See `graphrag/README.md`.
  It was verified against the SDK's real signatures and a live FalkorDB connection, but **not** end-to-end with an LLM (no key was available).

## Security notes

Browser ↔ `/api` only; the DB password and LLM key exist only in server env. All Cypher is parameterised (labels/relationship types are interpolated only from
whitelists). Inputs are length/format-validated, JSON bodies capped at 20 kB, CSP restricts scripts/styles to `self` and frames to YouTube. There is no
user authentication: the two profiles are local demo profiles, not accounts — put the app behind auth before exposing it publicly.
