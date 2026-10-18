# Instructions for AI coding tools

Before making any change, read:

1. [`docs/RULES.md`](docs/RULES.md) — mandatory rules: no unnecessary dependencies, don't break existing APIs, test after every change.
2. [`docs/MEMORY.md`](docs/MEMORY.md) — project context, current state and change log (so you don't need to read the whole codebase).
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — tech stack, folder structure, API flow and graph database schema, as needed.

After every change: run `FALKORDB_PORT=<port> npm test` against a real FalkorDB, and add an entry to the change log in `docs/MEMORY.md`.
