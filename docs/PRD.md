# Product Requirements Document — Nihongo Graph

| | |
| --- | --- |
| **Product** | Nihongo Graph — a Japanese-learning companion with persistent graph memory |
| **Status** | v1.0 built (FalkorDB hackathon, Track 2: Agent Memory and Coordination); this document records its requirements and the next steps |
| **Related docs** | [README](../README.md) · [Architecture](ARCHITECTURE.md) · [Demo script](DEMO_SCRIPT.md) · [Resource inventory](RESOURCE_INVENTORY.md) |

Requirement status: **✅ Done** (implemented and covered by tests or a UI run, see the README's *Verification status*) · **◐ Partial** · **☐ Planned**.

---

## 1. Problem

Beginners learning Japanese on their own run into the same problems:

* **They forget what they studied and where they went wrong.** Flashcard apps track cards, not *patterns* of mistakes (for example, mixing up に and で across several sessions).
* **Generic apps do not adapt the next lesson.** The next lesson rarely depends on what the learner actually got wrong, which prerequisites are weak, or what they found hard to listen to.
* **Recommendations are opaque.** Learners are told *what* to study, never *why*, so they cannot trust or correct the plan.
* **There is no clear starting order.** Beginners do not know whether to start with kana, words, grammar or kanji.

## 2. Product vision

A study companion that **remembers** each learner in a graph (what they studied, what they missed, how they prefer to study) and uses that memory to choose the **next lesson**, with **evidence** the learner can inspect. Three coordinated agents (**Tutor**, **Examiner**, **Memory & Planner**) share state only through the graph, so every decision can be traced.

## 3. Goals and non-goals

### Goals
1. **G1 — Adaptive revision:** recurring mistakes, weak prerequisites, confusable pairs and overdue items change the next session.
2. **G2 — Clear beginner path:** a fixed order from Hiragana to JLPT N5, with the learner's position always visible.
3. **G3 — Traceable recommendations:** every recommendation links to the graph evidence and rule that produced it.
4. **G4 — Works without an LLM:** full functionality in deterministic *Demo mode*; an LLM only rewords text in optional *AI mode*.
5. **G5 — Personal and private:** each account has its own learner, memory and history, isolated from every other learner.
6. **G6 — Honest content:** only real, licensed or linked material; missing features (transcripts, stroke animation) are stated rather than faked.

### Non-goals (for this version)
* Conversation or speaking practice, and a greetings/conversation step in the path (the source material does not cover it).
* Animated or verified stroke order (stroke-order PDFs are linked by page only).
* Listening transcripts (none exist for the linked videos).
* Levels beyond JLPT N5.
* Native mobile apps (the web UI is responsive instead).
* Teacher/classroom features, social features, payments.
* LLM-generated recommendations (recommendations stay rule-based on the graph).

## 4. Target users

### Primary personas

| Persona | Description | Needs | What the product gives them |
| --- | --- | --- | --- |
| **P1 — Absolute beginner** ("Sam") | Adult who has never studied Japanese; cannot read kana yet. Studies 10–15 minutes a day. | Know where to start; short sessions; not be overwhelmed. | Learning path starting at Hiragana, *Start here* note, 3/5/8-question sessions. |
| **P2 — JLPT N5 self-studier** ("Priya") | Knows kana, working through N5 vocabulary, kanji and grammar for the exam. | Coverage of the N5 syllabus; targeted revision of weak points; search across material. | Library with ~856 words, 103 kanji, 152 grammar points; due-item scheduling; recurring-mistake revision. |
| **P3 — Returning learner** ("Aiko", the demo learner) | Studied before, keeps confusing similar grammar (に / で); comes back after a break. | Pick up where they left off; fix recurring mistakes first. | Persistent memory; contrast revision of confusable pairs; *Why this recommendation?* evidence. |
| **P4 — Listening learner** | Wants comprehension practice alongside study. | Videos at a suitable level linked to what they study. | Lazy Benkyou videos linked by topic, comprehension ratings that feed back into revision. |

### Secondary users
* **Guests / evaluators (hackathon judges, curious visitors):** browse the seeded demo learner without signing up.
* **Developers / self-hosters:** run the app with Docker or Node, add study material to `resources/`, optionally enable AI mode or the GraphRAG sidecar.

### Assumptions about users
* Reads English; uses a modern desktop or mobile browser.
* Studies alone, without a teacher.
* May be offline from AI providers (Demo mode must be enough).

## 5. User stories

| ID | As a… | I want to… | So that… |
| --- | --- | --- | --- |
| US-1 | beginner | see a learning path with "You are here" | I know what to study next |
| US-2 | learner | start today's session in one click | I can study without planning |
| US-3 | learner | get feedback right after each answer, with how my memory changed | I learn from mistakes immediately |
| US-4 | learner | see *why* a lesson was recommended | I can trust the plan |
| US-5 | learner who keeps confusing に and で | practise them side by side | I can tell them apart |
| US-6 | learner | items I got right to come back later, and misses to come back now | I review at the right time |
| US-7 | learner | set session length, question format, listening on/off and revision pace | sessions fit my habits |
| US-8 | learner | search the library in Japanese, kana, romaji or English | I can look anything up quickly |
| US-9 | learner | watch videos on today's topic and rate how much I understood | listening supports what I study |
| US-10 | learner | ask the Tutor a question and get an answer from the course material | I get help without leaving the app |
| US-11 | learner | create an account and come back to my own progress | my progress is saved and private |
| US-12 | learner | delete my progress but keep my account | I can start over |
| US-13 | guest / judge | explore a seeded demo learner without signing up | I can evaluate the product quickly |
| US-14 | learner | see the agents' timeline and my memory graph | I understand what the system knows about me |

## 6. Functional requirements

### 6.1 Accounts and access
| ID | Requirement | Status |
| --- | --- | --- |
| FR-1 | Users sign up / sign in with Google (no password) and sign out. Email + password is legacy, off unless `PASSWORD_AUTH=1`; such accounts are linked to Google by verified email. | ✅ |
| FR-2 | Every account gets exactly one learner of its own; its learning path, memory and history are separate from all others. | ✅ |
| FR-3 | Visitors without an account browse the seeded demo learner, or *continue as guest*: a guest account with its own learner whose progress is kept for that browser (cookie) and moves into a Google account on Google sign-in. Anyone with an account can switch to the demo learner and back. | ✅ |
| FR-4 | Sign-ins expire after a configurable period (default 30 days). | ✅ |
| FR-5 | Account deletion (guest accounts are deleted on sign-out; email verification and password reset are left to Google). | ☐ |

### 6.2 Today (dashboard)
| ID | Requirement | Status |
| --- | --- | --- |
| FR-6 | Show today's plan, the primary recommendation and a *Why this recommendation?* panel with rule, mistake counts (demo vs live), graph path and memory version. | ✅ |
| FR-7 | Show the learning path: Hiragana → Katakana → First words → Sentence patterns → First kanji → JLPT N5 extension, each step *Completed* / *You are here* / *Upcoming*, with progress, prerequisites, *Continue this step* and *Revisit*. | ✅ |
| FR-8 | Show progress, recent activity and mistakes, grammar to revise, due items, a listening pick and the learner-memory graph. | ✅ |
| FR-9 | New learners see a short *Start here* note. | ✅ |

### 6.3 Practice sessions
| ID | Requirement | Status |
| --- | --- | --- |
| FR-10 | A session starts with a Tutor briefing (explanation sourced from the material, with its source shown). | ✅ |
| FR-11 | The Examiner selects N questions (default 5; 3/5/8 by preference): targeted revision, the confusable partner, overdue items, then new material from the current path step; each question shows why it was chosen. | ✅ |
| FR-12 | Question formats: multiple choice, typed answer, flashcard; content types: vocabulary, kana, kanji, grammar. | ✅ |
| FR-13 | Grading rules: exact choice; typed answers normalised (katakana→hiragana, romaji accepted); meaning recall with variants and a 1-edit typo tolerance flagged *ambiguous*; alternative valid answers accepted and flagged. | ✅ |
| FR-14 | After each answer, show correct/incorrect, the expected answer and the memory update (mastery before → after, status). | ✅ |
| FR-15 | Submitting the same answer twice (retry, double click) never double-counts. | ✅ |
| FR-16 | A page reload resumes the session in progress. | ✅ |
| FR-17 | Finishing a session shows a summary and the next recommendation. | ✅ |

### 6.4 Memory and recommendations
| ID | Requirement | Status |
| --- | --- | --- |
| FR-18 | Store episodic (sessions, attempts, mistakes, listening logs, agent events), semantic (one per-concept study edge with estimated mastery and status) and procedural (preferences, learning path) memory in the graph. | ✅ |
| FR-19 | Recommendation priority: (1) recurring mistake → prerequisite revision, contrast revision or concept revision; (2) listening gap; (3) overdue review; (4) new material from the current path step. | ✅ |
| FR-20 | A recommendation is recomputed whenever the learner's memory has changed since it was made; old recommendations are kept as *superseded*. | ✅ |
| FR-21 | Spaced review: a correct answer schedules the next review (interval × pace); a miss is due immediately. | ✅ |
| FR-22 | Explicit preferences (session length, format, listening on/off, revision pace) can be set, overridden and deleted; format preference is also inferred from accuracy (≥ 4 attempts, ≥ 20-point lead). | ✅ |
| FR-23 | The Memory page shows the real agent timeline, the three memory types, a preference editor and a bounded graph explorer. | ✅ |
| FR-24 | Reset: *Restore seeded demo* for the demo learner; *Delete my progress* for an account (the account is kept). | ✅ |

### 6.5 Library
| ID | Requirement | Status |
| --- | --- | --- |
| FR-25 | Browse and search vocabulary, kana, kanji, grammar, stroke-order references, reading links, listening and exercises by Japanese, kana, romaji, English or tag. | ✅ |
| FR-26 | Library views are deep-linkable from the learning path (e.g. `#/library?tab=kana&topic=hiragana`). | ✅ |
| FR-27 | Each item shows its source and licence; original vs generated exercises are labelled. | ✅ |
| FR-28 | Animated stroke order. | ☐ (non-goal for now) |

### 6.6 Listening
| ID | Requirement | Status |
| --- | --- | --- |
| FR-29 | Embed verified Lazy Benkyou videos (never re-hosted) with a direct YouTube link as fallback. | ✅ |
| FR-30 | Learners can save lessons, write notes and rate comprehension (1–5). | ✅ |
| FR-31 | A low rating (≤ 2) on a lesson whose topic links to unmastered concepts triggers topic revision. | ✅ |
| FR-32 | A secondary listening recommendation picks the unwatched lesson sharing the most topics with the focus, and says when nothing matches. | ✅ |
| FR-33 | Transcript-based listening practice. | ☐ (no transcripts available) |

### 6.7 Ask the Tutor and AI mode
| ID | Requirement | Status |
| --- | --- | --- |
| FR-34 | *Ask the Tutor* answers only from retrieved course material and graph neighbours; with no match it says it doesn't know. | ✅ |
| FR-35 | AI mode turns on only when provider, key and model are all set; the current mode is shown in the header and `/api/health`. | ✅ |
| FR-36 | In AI mode the LLM only rewords explanations and answers; output is validated (JSON shape, length, no figures absent from the evidence) and falls back to deterministic text on failure. | ✅ (not tested with a real LLM) |
| FR-37 | Optional GraphRAG-SDK sidecar when `GRAPHRAG_URL` is set. | ◐ (not tested end to end) |

### 6.8 Content ingestion
| ID | Requirement | Status |
| --- | --- | --- |
| FR-38 | Ingest CSV, JSON, JSONL and PDF study lists from `resources/`; incremental by checksum, forced re-ingest on demand, no duplicates on repeat. | ✅ |
| FR-39 | Curated original content is never overwritten by later local files; provenance (file, row/page) and licence are recorded per item. | ✅ |
| FR-40 | Unsupported or broken files are reported, not fatal. | ✅ |

## 7. Non-functional requirements

| ID | Area | Requirement | Status |
| --- | --- | --- | --- |
| NFR-1 | Security | Google sign-in uses the authorization-code flow with PKCE, `state` and `nonce`; the client secret stays on the server. Legacy passwords stored only as salted scrypt hashes. | ✅ |
| NFR-2 | Security | Session cookie is a random 256-bit token, `HttpOnly`, `SameSite=Lax`, optional `Secure`; only its SHA-256 is stored. | ✅ |
| NFR-3 | Security | Cross-site writes rejected (`Origin` check); sign-in/sign-up rate-limited to 20 attempts / 10 min / IP. | ✅ (in-process limiter) |
| NFR-4 | Security | Database password and LLM key never reach the browser; all Cypher parameterised; inputs validated; JSON bodies ≤ 20 kB; strict CSP. | ✅ |
| NFR-5 | Privacy / isolation | A learner can never read or change another learner's sessions, attempts, listening logs, timeline or graph neighbourhood. | ✅ |
| NFR-6 | Persistence | Learner data survives restarts (FalkorDB AOF + volume). | ✅ |
| NFR-7 | Reliability | The app retries the database for ~60 s at startup and shows a clear "database is starting up" state; health endpoint returns 503 when the DB is down. | ✅ |
| NFR-8 | Consistency | Memory writes for one learner are serialised; attempts and listening logs are idempotent by client id. | ✅ (single instance only) |
| NFR-9 | Explainability | Every agent step writes an event with what it read, changed and produced; the timeline is never synthesised. | ✅ |
| NFR-10 | Performance | Lightweight frontend (vanilla JS, no build step, ~70 kB unminified, loaded per page); graph queries bounded by limits. | ✅ |
| NFR-11 | Responsiveness | Usable at mobile (375–390 px) and desktop widths with no horizontal overflow. | ✅ |
| NFR-12 | Accessibility | Keyboard-usable controls and readable contrast; formal WCAG 2.1 AA audit. | ◐ (audit not done) |
| NFR-13 | Offline / cost | Fully functional with no LLM key (Demo mode). | ✅ |
| NFR-14 | Licensing | Third-party content used only under its licence; Lazy Benkyou content linked/embedded only; licences recorded per file. | ✅ |
| NFR-15 | Deployability | One-command start with Docker Compose; Node ≥ 20 alternative. | ✅ (Compose not run in sandbox) |
| NFR-16 | Scalability | Multiple app instances (shared lock and rate limit). | ☐ |

## 8. Content scope

| Content | Original (curated) | With JLPT N5 files in `resources/local/` |
| --- | --- | --- |
| Vocabulary | 56 | ~856 |
| Kanji | 26 | 103 |
| Grammar points | 16 | 152 |
| Kana | 92 | 92 |
| Listening videos | 15 verified Lazy Benkyou videos | — |
| Stroke-order references | — | 79 kanji, 92 kana (linked by PDF page) |

Details and licences: [RESOURCE_INVENTORY.md](RESOURCE_INVENTORY.md).

## 9. Success metrics

| Metric | Definition | Target (initial) |
| --- | --- | --- |
| Session completion rate | Sessions completed / sessions started | ≥ 70 % |
| Recurring-mistake recovery | Share of concepts flagged *struggling* that reach *learning* or *mastered* within 3 later sessions | ≥ 50 % |
| Due-review accuracy | Correct answers on items shown as *due for review* | ≥ 75 % |
| Path progress | Median path steps completed after 4 weeks for new accounts | ≥ 2 |
| Retention | Accounts with a session 7 / 30 days after sign-up | ≥ 40 % / ≥ 20 % |
| Recommendation trust | Share of sessions started from the recommended plan; *Why?* panel opens | Tracked (baseline first) |
| Reliability | Requests that return 5xx while the DB is up | < 0.5 % |

These metrics can be computed from data already in the graph (sessions, attempts, `STUDIES` edges, agent events); no external analytics are required.

## 10. Constraints and assumptions

* Built for the FalkorDB hackathon, Track 2; FalkorDB is the only data store.
* Recommendations must stay rule-based and explainable; an LLM may never decide what to study.
* Content is limited to what the provided files and linked videos contain; nothing is invented.
* A path step counts as *completed* once every item has been practised at least once (not mastered).
* Single app instance: the write lock and rate limiter are in-process.

## 11. Known limitations

See the README's [*Known limitations*](../README.md#known-limitations). In short: no email verification, password reset or account deletion; no greetings/conversation step; no stroke animation or transcripts; topic links rely on keywords in video titles; single-instance only.

## 12. Roadmap

| Priority | Item | Related |
| --- | --- | --- |
| P1 | Password reset and email verification | FR-5 |
| P1 | Account deletion (with all learner data) | FR-5, NFR-5 |
| P2 | Shared lock and rate limit (e.g. in FalkorDB/Redis) to allow multiple instances | NFR-3, NFR-8, NFR-16 |
| P2 | Accessibility audit (WCAG 2.1 AA) and fixes | NFR-12 |
| P2 | Success-metric reporting built from the graph | §9 |
| P3 | Greetings/conversation path step, once suitable licensed material exists | Non-goals |
| P3 | Content beyond N5 (N4) | Non-goals |
| P3 | End-to-end verification of AI mode and the GraphRAG sidecar with a real LLM | FR-36, FR-37 |

## 13. Open questions

1. Should a path step require *mastery* rather than one practice of each item before it counts as completed?
2. Which email provider should send verification and reset emails, and is a self-hosted option required?
3. Should learners be able to export their learning history?
4. What session-length and pace defaults work best for P1 beginners, and should they be chosen during onboarding?
5. Is there a licensed source of listening transcripts or stroke data worth integrating?
