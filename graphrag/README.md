# GraphRAG-SDK sidecar (optional, AI mode)

The main app answers “Ask the Tutor” questions with Cypher retrieval over FalkorDB and works with no Python at all.
This sidecar adds the official [FalkorDB GraphRAG-SDK](https://github.com/FalkorDB/GraphRAG-SDK) (Python ≥ 3.10):
it ingests the project's grammar and vocabulary documents, lets an LLM extract an entity graph into a **separate**
FalkorDB graph (`nihongo_rag`), and answers with `GraphRAG.completion()`.

```
Node app  --POST /ask-->  sidecar (aiohttp)  --GraphRAG-SDK-->  FalkorDB graph "nihongo_rag"  (+ your LLM provider)
```

Needs an LLM **and** an embedding model (the SDK requires both). Example with OpenAI via LiteLLM:

```bash
pip install -r graphrag/requirements.txt
export FALKORDB_PORT=6379 LLM_API_KEY=sk-... GRAPHRAG_LLM_MODEL=openai/gpt-4o-mini GRAPHRAG_EMBED_MODEL=openai/text-embedding-3-small
python graphrag/app.py --ingest        # idempotent: uses update(..., if_missing="ingest") then finalize()
python graphrag/app.py                 # serves :8010
# then run the Node app with GRAPHRAG_URL=http://localhost:8010 and an LLM configured (AI mode)
```

If FalkorDB is published on a non-default host port (e.g. `-p 6380:6379` because 6379 is taken), set `FALKORDB_PORT=6380` here too, and give the Node app the same value.

Model ids are whatever LiteLLM accepts for your provider. Without these variables `/health` reports
`configured: false` and `/ask` returns 503, and the Node app falls back to its own retrieval.
