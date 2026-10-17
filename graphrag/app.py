"""Optional GraphRAG-SDK sidecar for Nihongo Graph (AI mode only).

The Node app never needs this service: in demo mode it answers questions with plain Cypher retrieval over the
same FalkorDB. When GRAPHRAG_URL is set *and* an LLM is configured, the Node app forwards `/ask` questions here
so the official FalkorDB GraphRAG-SDK (https://github.com/FalkorDB/GraphRAG-SDK) can answer over an
LLM-extracted entity graph built from the project's own resources.

SDK calls used (verified against graphrag-sdk 1.4.0): GraphRAG(connection, llm, embedder), ingest(text=, document_id=),
update(...), finalize(), completion(question, return_context=True).

The SDK writes to its OWN graph (GRAPHRAG_GRAPH, default "nihongo_rag"), separate from the learner-memory graph.
"""
import csv
import json
import os
from pathlib import Path

from aiohttp import web

RES = Path(os.environ.get("RESOURCES_DIR", Path(__file__).resolve().parent.parent / "resources")) / "original"
CFG = {
    "host": os.environ.get("FALKORDB_HOST", "localhost"),
    "port": int(os.environ.get("FALKORDB_PORT", "6380")),
    "password": os.environ.get("FALKORDB_PASSWORD") or None,
    "graph": os.environ.get("GRAPHRAG_GRAPH", "nihongo_rag"),
    "api_key": os.environ.get("LLM_API_KEY", ""),
    "llm": os.environ.get("GRAPHRAG_LLM_MODEL", ""),
    "embed": os.environ.get("GRAPHRAG_EMBED_MODEL", ""),
}


def configured() -> bool:
    return bool(CFG["api_key"] and CFG["llm"] and CFG["embed"])


def make_rag():
    from graphrag_sdk import ConnectionConfig, GraphRAG, LiteLLM, LiteLLMEmbedder

    return GraphRAG(
        connection=ConnectionConfig(host=CFG["host"], port=CFG["port"], password=CFG["password"], graph_name=CFG["graph"]),
        llm=LiteLLM(model=CFG["llm"], api_key=CFG["api_key"]),
        embedder=LiteLLMEmbedder(model=CFG["embed"], api_key=CFG["api_key"], dimensions=256),
    )


def documents():
    """One short, source-attributed document per grammar concept and per vocabulary topic (not whole files)."""
    docs = []
    for g in json.loads((RES / "grammar.json").read_text(encoding="utf-8")):
        ex = "; ".join(f"{e['jp']} ({e['en']})" for e in g.get("examples", []))
        docs.append((f"grammar:{g['id']}", f"Grammar point {g['name']} ({g['pattern']}). {g['explanation']} Examples: {ex}"))
    by_topic = {}
    with open(RES / "vocabulary.csv", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            by_topic.setdefault(row["topic"], []).append(f"{row['word']} ({row['reading']}) means {row['meaning']}")
    for topic, items in by_topic.items():
        docs.append((f"vocab:{topic}", f"Vocabulary about {topic}: " + "; ".join(items)))
    return docs


async def ingest_all():
    async with make_rag() as rag:
        for doc_id, text in documents():
            await rag.update(text=text, document_id=doc_id, if_missing="ingest")  # idempotent re-ingestion
        result = await rag.finalize()
    return {"documents": len(documents()), "finalize": str(result)}


async def health(_):
    return web.json_response({"ok": True, "configured": configured(), "graph": CFG["graph"]})


async def ingest(_):
    if not configured():
        return web.json_response({"error": "LLM_API_KEY, GRAPHRAG_LLM_MODEL and GRAPHRAG_EMBED_MODEL must be set"}, status=503)
    return web.json_response(await ingest_all())


async def ask(request):
    if not configured():
        return web.json_response({"error": "GraphRAG sidecar is not configured with an LLM"}, status=503)
    question = str((await request.json()).get("question", ""))[:300]
    if not question.strip():
        return web.json_response({"error": "question is required"}, status=400)
    async with make_rag() as rag:
        res = await rag.completion(question, return_context=True)
    ctx = getattr(res.retriever_result, "items", None) if getattr(res, "retriever_result", None) else None
    return web.json_response({"answer": res.answer, "context": [str(i)[:400] for i in (ctx or [])][:5]})


def create_app():
    app = web.Application()
    app.add_routes([web.get("/health", health), web.post("/ingest", ingest), web.post("/ask", ask)])
    return app


if __name__ == "__main__":
    import sys

    if "--ingest" in sys.argv:
        import asyncio

        print(asyncio.run(ingest_all()))
    else:
        web.run_app(create_app(), host="0.0.0.0", port=int(os.environ.get("PORT", "8010")))
