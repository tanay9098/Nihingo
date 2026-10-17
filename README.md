# Nihongo Graph

A Japanese-learning companion that **remembers** what a learner has studied and adapts the next lesson.
Persistent **FalkorDB** graph memory + three coordinated agents (**Tutor**, **Examiner**, **Memory & Planner**) —
built for the FalkorDB hackathon, **Track 2: Agent Memory and Coordination**.

* Vanilla HTML/CSS/JS frontend (no framework, no build step, ~60 kB of unminified JS, loaded per page) · Node + Express backend · FalkorDB via the official `falkordb` client.
* Episodic, semantic and procedural memory in the graph; recommendations carry traceable evidence (“why this lesson?”).
* Listening practice linked to verified [Lazy Benkyou](https://lazybenkyou.com/) videos (embedded via YouTube, never re-hosted).
* **Demo mode** (default) needs no LLM key. **AI mode** is optional and clearly labelled.

> Start with **[docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)** for the 5-minute walkthrough, **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the graph schema and agent workflow,
> and **[docs/RESOURCE_INVENTORY.md](docs/RESOURCE_INVENTORY.md)** for what content exists, where it comes from and its licensing.

## Quick start

### Option A — Docker Compose (recommended)
```bash
cp .env.example .env          # optional: set FALKORDB_PASSWORD, LLM_*; defaults work as-is
docker compose up --build
```
Open <http://localhost:3002>. FalkorDB Browser is at <http://localhost:3000>. On first boot the app creates the schema, ingests `resources/`, and seeds the demo learner.
Data persists in the `falkordb_data` volume (AOF enabled). Add `--profile graphrag` to also start the optional GraphRAG-SDK sidecar.

### Option B — Node locally + FalkorDB in Docker
```bash
docker run -d --name nihongo-falkordb -p 6380:6379 -p 3000:3000 falkordb/falkordb:v4.18.9
npm install
npm start                      # http://localhost:3002
```
The database is published on host port **6380** (the container itself still listens on its own 6379) and the app runs on **3002**; both are the defaults, so no `.env` is needed.
If `docker run` says `port is already allocated`, something else uses that host port — check with `docker ps -a` and `sudo ss -ltnp | grep -E '6380|3000|3002'`, and remove a stale container of the same name with `docker rm nihongo-falkordb`.
On later runs the container already exists: `docker start nihongo-falkordb`, then `npm start`.
Requires Node ≥ 20 (developed on 22). Optional: `poppler-utils` (`pdftotext`) enables PDF text extraction during ingestion.

### Option C — no Docker
Any Redis server that can load the FalkorDB module works, e.g. with the module bundled in the `falkordblite` wheel:
```bash
pip install falkordblite
B=$(python -c "import redislite,os;print(os.path.join(os.path.dirname(redislite.__file__),'bin'))")
$B/redis-server --port 6380 --appendonly yes --loadmodule $B/falkordb.so --daemonize yes
npm install && npm start
```

### Useful commands
| Command | What it does |
| --- | --- |
| `npm start` | Server (connects with retries, creates schema, ingests, seeds the demo learner unless `AUTO_BOOTSTRAP=0`) |
| `npm run init` | Create indexes/constraints (idempotent) |
| `npm run ingest` / `-- --force` | Incremental / forced resource ingestion; refreshes the table in `docs/RESOURCE_INVENTORY.md` |
| `npm run seed:demo` | (Re)seed the demo learner (clearly flagged demo data) |
| `npm run demo:flow` | Print the full two-session demo, evidence and agent handoffs |
| `npm run catalog` | Rebuild the Lazy Benkyou catalog from the channel's public RSS feed + oEmbed |
| `npm test` | Unit + integration tests (integration needs FalkorDB: `FALKORDB_HOST`/`FALKORDB_PORT`; each run uses and deletes its own throw-away graph) |

## Configuration (`.env.example`)
| Variable | Default | Purpose |
| --- | --- | --- |
| `FALKORDB_HOST` / `FALKORDB_PORT` / `FALKORDB_PASSWORD` / `FALKORDB_GRAPH` | localhost / 6380 / empty / `nihongo` | Server-side DB connection (never sent to the browser) |
| `PORT` | 3002 | App port |
| `AUTO_BOOTSTRAP` | 1 | `0` skips ingestion/seeding on boot |
| `LLM_PROVIDER` (`anthropic`\|`openai`), `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | empty | **AI mode** only when provider + key + model are all set; otherwise **Demo mode** (shown in the header badge and `/api/health`) |
| `GRAPHRAG_URL` | empty | Optional GraphRAG-SDK sidecar (see `graphrag/README.md`) |

In AI mode the LLM only rewords explanations / answers questions from graph evidence; its output is validated (JSON shape, length, no figures that aren't in the evidence)
and any failure falls back to the deterministic text. Recommendations themselves are always rule-based on the graph.

## What's in the app
* **Today** – plan, evidence (“why?”), progress, recent activity/mistakes, grammar to revise, due items, listening pick, learner-memory graph.
* **Practice** – Tutor briefing → Examiner questions (multiple choice, typed, flashcards; vocabulary, kana, kanji, grammar) → graded feedback with the memory update → summary and next recommendation. A reload resumes the session.
* **Library** – search by Japanese, kana, romaji, English or tag; vocabulary, kana, kanji, stroke order (counts + any linked reference files), grammar, reading (links to Lazy Benkyou's Story Reader), listening, exercises (original vs generated).
* **Listening** – 15 verified Lazy Benkyou videos, embed + direct link, saved lessons, notes, comprehension ratings. No transcripts exist, so transcript practice is honestly unavailable.
* **Memory** – real agent timeline, the three memory types, preference editor, bounded graph explorer, source-grounded “Ask the Tutor”, reset.

REST API (all JSON `{ok, data | error}`; learner via `X-Learner-Id`): `GET /api/health` · `/api/dashboard` · `/api/library[?q&kind&topic]` · `/api/library/item?id=` · `/api/resources[/:id]` ·
`/api/listening` · `POST /api/listening/:id/log|save` · `/api/learner/memory` · `/api/learner/sessions` · `POST /api/sessions` · `POST /api/attempts` · `POST /api/sessions/:id/complete` ·
`/api/recommendations` · `/api/agents/timeline` · `/api/graph/neighborhood` · `POST /api/feedback` · `POST /api/learner/reset` · `POST /api/tutor/ask`.

## Verification status (honest)

Run in the development sandbox on **Oct 17 2026**:
* ✅ `npm test` — 45 tests (19 unit + 26 integration) pass against a **real FalkorDB module (v4.18.3)**: ingestion with the real CSV/JSON schemas, every recognised PDF study-list layout, local files never overwriting original content, unsupported/broken file handling, a real PDF with Japanese text,
  repeat-ingestion without duplicates, idempotent attempts (including concurrent duplicates), memory change after an attempt, recommendation change after a session, agent handoff chain from stored events,
  procedural preferences, listening logs, bounded graph queries, injection attempts, secrets not in any response or in browser code, DB-down behaviour.
* ✅ Real headless Chromium run of the UI (desktop 1200 px and mobile 390 px): all five pages load with **no console/CSP errors**, no horizontal overflow, and the two-session demo completes through the UI. This found and fixed a real bug (Unicode ids rejected by validation).
* ✅ `docker compose config` validates the Compose file; the Lazy Benkyou links, channel feed and each video's embeddability (oEmbed) were checked live against YouTube.
* ❌ **Not run here:** `docker compose up` / the Docker image build (no Docker daemon in the sandbox — the Dockerfile and Compose were written to the official docs, the `falkordb/falkordb:v4.18.9` tag was confirmed to exist on Docker Hub,
  but the volume path could not be read from the image, so Compose pins Redis' `--dir /data` explicitly); **AI mode** with a real LLM; the **GraphRAG-SDK** `ingest`/`completion` calls (only its API signatures and a live FalkorDB connection were verified);
  actual **YouTube playback** (the sandbox can't stream video; embeds and fallbacks are in place). There is no stroke *animation*: the stroke-order PDFs in `resources/local/` are linked by page, not parsed into strokes.

## Known limitations
* No authentication: two local profiles (`learner:demo`, `learner:me`), not accounts.
* The original content is small by design (56 words, 26 kanji, 16 grammar points, 92 kana). With the JLPT N5 files in `resources/local/` the library holds 856 words, 103 kanji and 152 grammar points;
  that material comes from third-party lists (see `docs/RESOURCE_INVENTORY.md`) and carries their quirks. Stroke order is linked as **pages** of the reference PDFs (79 kanji, 92 kana), never animated or verified.
* The per-learner write lock is in-process (single app instance).
* Topic links between concepts and lessons rely on keywords in video titles; when nothing matches, the app says so instead of inventing a link.

## Troubleshooting
| Symptom | Fix |
| --- | --- |
| “The graph database is starting up” / health returns 503 | FalkorDB isn't reachable yet. `docker compose ps`; check `FALKORDB_HOST/PORT/PASSWORD`. The app retries for ~60 s. |
| `NOAUTH` / `WRONGPASS` errors | Set the same `FALKORDB_PASSWORD` for the app and the database (Compose passes it as `--requirepass`). |
| Port already in use (`port is already allocated`, `EADDRINUSE`) | Find what holds the port (`docker ps -a`, `sudo ss -ltnp \| grep -E '6380\|3002'`) and stop it, or change `PORT` / `FALKORDB_PORT` in `.env` (with Compose the same two variables change the host ports). |
| `SocketClosedUnexpectedlyError` / `Unhandled 'error' event` at startup | Something that isn't this project's FalkorDB answers on `FALKORDB_PORT`, or the DB container never started (`docker ps -a`; a container stuck in `Created` means its port was taken). Remove it with `docker rm nihongo-falkordb` and start it again (Option B). |
| Empty library / no demo data | `AUTO_BOOTSTRAP=0` is set, or ingestion failed: run `npm run ingest` then `npm run seed:demo`. |
| PDFs show as “linked” only | Install `poppler-utils` (`pdftotext`, `pdfinfo`). Image-only PDFs can't be text-extracted. |
| YouTube video won't play | Offline/blocked/embedding disabled: use the “Open it on YouTube” link. The rest of the app is unaffected. |
| `npm test` skips integration tests | They need a reachable FalkorDB (`FALKORDB_PORT=…`). Skips are reported as skipped, not passed. |
| Start over | Memory → *Restore seeded demo* / *Delete my progress*, or `docker compose down -v` to drop the database volume. |

## License
MIT for the code and original content (see `LICENSE`). Lazy Benkyou content is © Lazy Benkyou Studios LLC and is only linked/embedded.
Files in `resources/local/` are third-party material under their own terms, recorded per file in `resources/sources.json` and `docs/RESOURCE_INVENTORY.md`:
the hanabira.org PDFs are CC BY 4.0 / CC BY-SA 4.0 (credit hanabira.org), the Nihongo Master lists are free downloads with no stated license, and the
NIHONGO ICHIBAN kana workbook is © Chinriu Honten Ltd., all rights reserved (personal printing only). They are not covered by this repository's MIT license.
