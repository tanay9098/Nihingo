# Development rules

These rules apply to every change in this repository, whether it is made by a person or by an AI coding tool.
Read this file and [`MEMORY.md`](MEMORY.md) before starting; read [`ARCHITECTURE.md`](ARCHITECTURE.md) for details.

## 1. No unnecessary dependencies

* The app runs on exactly **two** runtime npm dependencies: `express` and `falkordb`. Keep it that way unless there is no reasonable alternative.
* Before adding a package, check whether Node's standard library (`node:crypto`, `node:fs`, `fetch`, `node:test`, `process.loadEnvFile`, …)
  or a few lines of code already in this repo do the job. Existing examples: own CSV parser, own scrypt auth, LLM calls with plain `fetch`, own SVG graph.
* The frontend stays vanilla HTML/CSS/JS ES modules: **no** framework, bundler, build step, CDN script or CSS library
  (the CSP allows scripts and styles only from `self`).
* If a new dependency is truly required, justify it in the commit message and in `docs/MEMORY.md`, pin it in `package.json`/`package-lock.json`
  (`npm install <pkg>` so the lockfile is updated), and prefer small, maintained packages with no transitive sprawl.
* Do not add dev tooling (linters, formatters, transpilers, test frameworks) without agreement; tests use `node --test`.

## 2. Don't break existing APIs

* Every endpoint listed in `docs/ARCHITECTURE.md` → *API flow → Endpoints* is a contract with the frontend (`public/js/*`) and the tests.
  Do not rename or remove a route, change its method, rename or remove request/response fields, or change their types or meaning.
* Keep the response envelope: `{ ok: true, data }` / `{ ok: false, error: { code, message } }`, and existing error `code`s and HTTP status codes.
* Changes must be **additive and backward-compatible**: new optional fields, new endpoints, new optional query parameters.
  If a breaking change is truly needed, add a new endpoint/field alongside the old one and update the frontend, tests and docs in the same change.
* The same applies to internal contracts that other code depends on: exported functions in `server/agents/*`, `server/graph/*`, `server/services/*`,
  the graph schema (labels, relationship types, property names, ids), environment variables, npm scripts and the Docker/Compose setup.
  Stored data must keep working: never require a manual migration or wipe of an existing FalkorDB volume.
* Keep the security invariants: parameterised Cypher only (labels/relationship types from whitelists), learner id only from the session cookie
  (or the demo learner), no secrets in browser code or responses, all dynamic text rendered with `textContent`.
* Respect the agent boundaries: only the Planner writes learner memory; the Examiner never writes; agents share state only through the graph;
  every agent step writes an `AgentEvent`.

## 3. Test after every change

* After **every** change run the full suite against a real FalkorDB and make sure it passes before committing:
  ```bash
  docker start nihongo-falkordb            # or any FalkorDB on a known port (see README → Quick start)
  FALKORDB_PORT=6380 npm test               # integration tests are SKIPPED, not passed, if no FalkorDB is reachable
  ```
  A run with skipped integration tests does not count as tested.
* Add or update tests for new behaviour and every bug fix: pure logic in `tests/unit.test.js`, ingestion in `tests/ingestion.test.js`,
  agent workflow in `tests/workflow.test.js`, HTTP behaviour in `tests/api.test.js`. Never delete, skip or weaken a test to make it pass.
* For UI changes, also open the app (`npm start`, <http://localhost:3002>) and check the affected pages in a browser at desktop and mobile width
  with no console/CSP errors. For changes to ingestion, run `npm run ingest` (and `-- --force` if needed); for the agent flow, `npm run demo:flow`.
* Report results honestly: if something could not be run, say so (see the *Verification status* section in `README.md`).

## 4. Keep the docs current

* After each change, add an entry to the *Change log* in `docs/MEMORY.md` (date, what changed, files, tests run) and update its
  *Current state* section if needed, so the next developer or AI tool does not have to re-read the whole codebase.
* If the change affects architecture, schema, endpoints, configuration or folder structure, update `docs/ARCHITECTURE.md` and `README.md` in the same commit.

## 5. Code style

* Match the surrounding code: ES modules, small focused functions, comment density and naming as in the file you edit.
* Keep changes minimal and focused on the task; no drive-by refactors.
* Never commit secrets (`.env` is git-ignored; document new variables in `.env.example`, `README.md` and `docker-compose.yml`).
