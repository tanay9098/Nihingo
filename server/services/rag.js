// Source-grounded retrieval over the knowledge graph ("graph RAG").
//  * Always available: Cypher retrieval of matching concepts + their neighbourhood + source resources.
//  * Optional: the Python GraphRAG-SDK sidecar (GRAPHRAG_URL) for LLM-extracted entity graphs over the
//    same text. See graphrag/README.md. It is only used in AI mode and never required.
import { config, appMode } from '../config.js';
import { askJson, numbersSubset } from './llm.js';

const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'what', 'how', 'do', 'i', 'to', 'of', 'in', 'and', 'or', 'when', 'use', 'does', 'mean', 'means', 'between', 'difference', 'vs', 'about', 'for', 'with']);

export function tokens(q) {
  return [...new Set(String(q).normalize('NFKC').toLowerCase().split(/[\s,.;:!?？。、「」()]+/).filter((t) => t && !STOP.has(t)))].slice(0, 6);
}

export class RagService {
  constructor({ catalog, client }) { Object.assign(this, { catalog, client }); }

  async retrieve(question, limit = 5) {
    const toks = tokens(question);
    if (!toks.length) return { tokens: toks, passages: [] };
    const hits = new Map();
    const KIND_RANK = { grammar: 0, vocabulary: 1, kanji: 2, kana: 3 };
    for (const t of toks) {
      const { items } = await this.catalog.search({ q: t, limit: 40 });
      for (const it of items) {
        const exact = [it.word, it.char, it.reading, it.romaji].some((f) => f && f.toLowerCase() === t)
          || (it.name && it.name.toLowerCase().startsWith(t))
          || (it.meaning && it.meaning.toLowerCase().split(/[;,]\s*/).some((m) => m.replace(/^to /, '') === t));
        const e = hits.get(it.id) ?? { it, score: 0 };
        e.score += exact ? 5 : 1;
        hits.set(it.id, e);
      }
    }
    const top = [...hits.values()]
      .sort((a, b) => b.score - a.score || (KIND_RANK[a.it.kind] ?? 9) - (KIND_RANK[b.it.kind] ?? 9) || a.it.id.localeCompare(b.it.id))
      .slice(0, limit);
    const passages = [];
    for (const { it } of top) {
      const c = await this.catalog.getConcept(it.id);
      if (!c) continue;
      const text = c.kind === 'grammar'
        ? `${c.name} — ${c.pattern}. ${c.explanation} Example: ${c.example} (${c.exampleMeaning}).`
        : c.kind === 'vocabulary'
          ? `${c.word} (${c.reading}) = ${c.meaning}. ${c.example ? `Example: ${c.example} (${c.exampleMeaning}).` : ''}`
          : c.kind === 'kanji'
            ? `${c.char}: ${c.meaning}. On: ${c.onyomi || '—'}; Kun: ${c.kunyomi || '—'}; ${c.strokes > 0 ? `${c.strokes} strokes` : 'stroke count unknown'}.`
            : `${c.char}: ${c.romaji} (${c.script}).`;
      passages.push({
        conceptId: c.id, kind: c.kind, text,
        related: c.related.slice(0, 6).map((r) => ({ rel: r.rel, outgoing: r.outgoing, id: r.id, name: r.name })),
        sources: c.resources.slice(0, 3).map((r) => ({ title: r.title, path: r.path, source: r.source, license: r.license, loc: r.loc })),
      });
    }
    return { tokens: toks, passages };
  }

  async ask(question) {
    const ctx = await this.retrieve(question);
    const base = { question, mode: appMode(), engine: 'cypher-graph-retrieval', retrieved: ctx.passages.length, passages: ctx.passages };
    if (!ctx.passages.length) return { ...base, answer: 'I could not find anything about that in the indexed library, so I will not guess. Try a Japanese word, a grammar name such as “particle に”, or an English meaning.', grounded: false };

    // Optional GraphRAG-SDK sidecar (AI mode only).
    if (appMode() === 'ai' && config.ragUrl) {
      try {
        const res = await fetch(`${config.ragUrl}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }), signal: AbortSignal.timeout(30000) });
        if (res.ok) {
          const body = await res.json();
          if (body.answer) return { ...base, engine: 'graphrag-sdk', answer: body.answer, grounded: true, sdkContext: body.context ?? null };
        }
      } catch { /* fall through to the next engine */ }
    }
    if (appMode() === 'ai') {
      const evidence = ctx.passages.map((p, i) => `[${i + 1}] ${p.text}`).join('\n');
      const r = await askJson({
        system: 'You are a Japanese tutor. Answer ONLY from the numbered passages. If they do not contain the answer, say so. Keep it under 90 words. JSON: {"answer": string}',
        user: `Question: ${question}\nPassages:\n${evidence}`,
        validate: (o) => {
          if (typeof o.answer !== 'string' || !o.answer.trim() || o.answer.length > 700) throw new Error('invalid answer');
          if (!numbersSubset(o.answer, evidence)) throw new Error('answer contains figures not present in the sources');
          return o.answer.trim();
        },
      });
      if (r.ok) return { ...base, engine: 'llm+cypher-graph-retrieval', answer: r.value, grounded: true };
    }
    const first = ctx.passages[0];
    return { ...base, grounded: true, answer: `Best match from the library: ${first.text}` };
  }
}
