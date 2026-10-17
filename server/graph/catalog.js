// Catalog store: learning content (concepts, exercises, resources, lessons) and its provenance.
// All writes are MERGE-based so re-running ingestion never duplicates nodes or relationships.

export const KINDS = {
  vocabulary: 'Vocabulary',
  kanji: 'Kanji',
  kana: 'Kana',
  grammar: 'GrammarConcept',
};
export const KIND_LABELS = Object.values(KINDS);
export const kindOfLabels = (labels = []) => Object.keys(KINDS).find((k) => labels.includes(KINDS[k])) || 'concept';

const assertLabel = (label) => {
  if (!KIND_LABELS.includes(label)) throw new Error(`Unknown concept label: ${label}`);
  return label;
};

export class CatalogStore {
  constructor(client) { this.c = client; }

  // ---------- writes (ingestion) ----------
  async getResourceChecksum(id) {
    const rows = await this.c.query('MATCH (r:Resource {id: $id}) RETURN r.checksum AS checksum, r.status AS status', { id });
    return rows[0] ?? null;
  }

  async upsertResource(r) {
    await this.c.query(
      `MERGE (r:Resource {id: $id})
       SET r += $props, r.ingestedAt = $now`,
      { id: r.id, props: r.props, now: Date.now() },
    );
  }

  async upsertConcepts(kind, rows) {
    const label = assertLabel(KINDS[kind]);
    if (!rows.length) return;
    await this.c.query(
      `UNWIND $rows AS r
       MERGE (c:Concept:${label} {id: r.id})
       SET c += r.props, c.updatedAt = $now`,
      { rows, now: Date.now() },
    );
  }

  /** Current properties of existing concepts, plus which resources already contain/explain them. */
  async existingConcepts(ids) {
    if (!ids.length) return new Map();
    const rows = await this.c.query(
      `MATCH (c:Concept) WHERE c.id IN $ids
       OPTIONAL MATCH (r:Resource)-[:CONTAINS|EXPLAINS]->(c)
       RETURN c.id AS id, properties(c) AS props, collect(r.id) AS sources`,
      { ids },
    );
    return new Map(rows.map((r) => [r.id, r]));
  }

  async linkResource(resId, rows, rel = 'CONTAINS') {
    if (!rows.length) return;
    if (!['CONTAINS', 'EXPLAINS', 'REFERENCES'].includes(rel)) throw new Error('bad rel');
    await this.c.query(
      `UNWIND $rows AS r
       MATCH (res:Resource {id: $rid}), (c {id: r.id})
       WHERE c:Concept OR c:Lesson OR c:Exercise
       MERGE (res)-[x:${rel}]->(c)
       SET x.loc = r.loc, x.flags = r.flags, x.page = r.page`,
      { rid: resId, rows: rows.map((r) => ({ id: r.id, loc: r.loc ?? '', flags: r.flags ?? [], page: r.page ?? 0 })) },
    );
  }

  async tagTopics(rows, label = 'Concept') {
    // rows: [{id, topics:[name]}]
    const flat = rows.flatMap((r) => (r.topics || []).map((t) => ({ id: r.id, topic: t })));
    if (!flat.length) return;
    if (!['Concept', 'Lesson'].includes(label)) throw new Error('bad label');
    await this.c.query(
      `UNWIND $flat AS f
       MERGE (t:Topic {id: 'topic:' + f.topic}) SET t.name = f.topic
       WITH f, t
       MATCH (n:${label} {id: f.id})
       MERGE (n)-[:TAGGED]->(t)`,
      { flat },
    );
  }

  async linkPairs(rel, pairs) {
    // pairs: [{from, to}] between Concept nodes
    if (!pairs.length) return;
    if (!['APPEARS_IN', 'REQUIRES', 'CONTRASTS_WITH'].includes(rel)) throw new Error('bad rel');
    await this.c.query(
      `UNWIND $pairs AS p
       MATCH (a:Concept {id: p.from}), (b:Concept {id: p.to})
       MERGE (a)-[:${rel}]->(b)`,
      { pairs },
    );
  }

  async upsertExercises(rows) {
    if (!rows.length) return;
    await this.c.query(
      `UNWIND $rows AS r
       MERGE (e:Exercise {id: r.id}) SET e += r.props, e.updatedAt = $now
       WITH e, r
       MATCH (c:Concept {id: r.conceptId})
       MERGE (e)-[:TESTS]->(c)`,
      { rows, now: Date.now() },
    );
  }

  async upsertLessons(rows) {
    if (!rows.length) return;
    await this.c.query(
      `UNWIND $rows AS r
       MERGE (l:Lesson {id: r.id}) SET l += r.props, l.updatedAt = $now`,
      { rows, now: Date.now() },
    );
  }

  // ---------- reads (library) ----------
  async counts() {
    const out = {};
    for (const [kind, label] of Object.entries(KINDS)) {
      const r = await this.c.read(`MATCH (c:${label}) RETURN count(c) AS n`);
      out[kind] = r[0]?.n ?? 0;
    }
    const e = await this.c.read('MATCH (e:Exercise) RETURN count(e) AS n');
    const l = await this.c.read('MATCH (l:Lesson) RETURN count(l) AS n');
    const r = await this.c.read('MATCH (r:Resource) RETURN count(r) AS n');
    return { ...out, exercises: e[0]?.n ?? 0, lessons: l[0]?.n ?? 0, resources: r[0]?.n ?? 0 };
  }

  async search({ q = '', kind = '', topic = '', limit = 30, offset = 0 }) {
    const label = kind && KINDS[kind] ? KINDS[kind] : 'Concept';
    const qn = String(q).normalize('NFKC').trim().toLowerCase();
    const qh = [...qn].map((ch) => {
      const c = ch.codePointAt(0);
      return c >= 0x30a1 && c <= 0x30f6 ? String.fromCodePoint(c - 0x60) : ch;
    }).join('');
    const match = topic
      ? `MATCH (c:${label})-[:TAGGED]->(:Topic {id: $topic})`
      : `MATCH (c:${label})`;
    const where = qn ? 'WHERE c.search CONTAINS $q OR c.search CONTAINS $qh' : '';
    const rows = await this.c.read(
      `${match} ${where}
       RETURN c.id AS id, labels(c) AS labels, c.word AS word, c.char AS char, c.name AS name,
              c.reading AS reading, c.romaji AS romaji, c.meaning AS meaning, c.pattern AS pattern,
              c.tags AS tags, c.strokes AS strokes, c.script AS script, c.order AS ord
       ORDER BY ord, id SKIP $offset LIMIT $limit`,
      { q: qn, qh, topic: topic ? `topic:${topic}` : '', limit: limit + 1, offset },
    );
    const more = rows.length > limit;
    return { items: rows.slice(0, limit).map((r) => ({ ...r, kind: kindOfLabels(r.labels) })), hasMore: more };
  }

  async exerciseSummary() {
    return this.c.read(
      `MATCH (e:Exercise) RETURN e.type AS type, e.format AS format, e.origin AS origin, count(e) AS n ORDER BY origin, type`,
    );
  }

  async topics() {
    return this.c.read(
      `MATCH (t:Topic)<-[:TAGGED]-(c:Concept) RETURN t.name AS name, count(c) AS n ORDER BY n DESC, name`,
    );
  }

  async getConcept(id) {
    const rows = await this.c.read('MATCH (c:Concept {id: $id}) RETURN c AS node, labels(c) AS labels', { id });
    if (!rows.length) return null;
    const node = rows[0].node.properties;
    const kind = kindOfLabels(rows[0].labels);
    const related = await this.c.read(
      `MATCH (c:Concept {id: $id})-[r:REQUIRES|CONTRASTS_WITH|APPEARS_IN]-(o:Concept)
       RETURN type(r) AS rel, startNode(r).id = $id AS outgoing, o.id AS id, labels(o) AS labels,
              coalesce(o.name, o.word, o.char) AS name, o.meaning AS meaning`,
      { id },
    );
    const topics = await this.c.read('MATCH (:Concept {id: $id})-[:TAGGED]->(t:Topic) RETURN t.name AS name', { id });
    const resources = await this.c.read(
      `MATCH (r:Resource)-[x:CONTAINS|EXPLAINS|REFERENCES]->(:Concept {id: $id})
       RETURN r.id AS id, r.title AS title, r.path AS path, r.source AS source, r.license AS license,
              r.format AS format, type(x) AS rel, x.loc AS loc, x.page AS page, r.url AS url`,
      { id },
    );
    const exercises = await this.c.read(
      `MATCH (e:Exercise)-[:TESTS]->(:Concept {id: $id})
       RETURN e.id AS id, e.type AS type, e.format AS format, e.origin AS origin ORDER BY e.id`,
      { id },
    );
    return {
      kind, ...node,
      related: related.map((r) => ({ ...r, kind: kindOfLabels(r.labels) })),
      topics: topics.map((t) => t.name), resources, exercises,
    };
  }

  async listResources({ limit = 100, offset = 0 } = {}) {
    return this.c.read(
      `MATCH (r:Resource) OPTIONAL MATCH (r)-[x:CONTAINS|REFERENCES|EXPLAINS]->(n)
       RETURN r.id AS id, r.title AS title, r.path AS path, r.format AS format, r.kind AS kind, r.source AS source,
              r.license AS license, r.url AS url, r.status AS status, r.checksum AS checksum, r.size AS size,
              r.notes AS notes, r.ingestedAt AS ingestedAt, count(x) AS links
       ORDER BY r.path SKIP $offset LIMIT $limit`,
      { limit, offset },
    );
  }

  async getResource(id) {
    const rows = await this.c.read('MATCH (r:Resource {id: $id}) RETURN r AS node', { id });
    if (!rows.length) return null;
    const linked = await this.c.read(
      `MATCH (:Resource {id: $id})-[x]->(n) RETURN type(x) AS rel, n.id AS id, labels(n) AS labels,
              coalesce(n.name, n.word, n.char, n.title, n.prompt) AS name, x.loc AS loc, x.page AS page
       ORDER BY id LIMIT 200`,
      { id },
    );
    return { ...rows[0].node.properties, linked: linked.map((l) => ({ ...l, kind: kindOfLabels(l.labels) })) };
  }

  async listLessons(learnerId) {
    return this.c.read(
      `MATCH (l:Lesson)
       OPTIONAL MATCH (l)-[:TAGGED]->(t:Topic)
       WITH l, collect(t.name) AS topics
       OPTIONAL MATCH (:Learner {id: $lid})-[sv:SAVED]->(l)
       OPTIONAL MATCH (g:ListeningLog {learnerId: $lid})-[:OF]->(l)
       WITH l, topics, count(sv) > 0 AS saved, count(g) AS watched, max(g.at) AS lastWatched,
            avg(g.rating) AS avgRating
       RETURN l.id AS id, l.videoId AS videoId, l.title AS title, l.url AS url, l.embedUrl AS embedUrl,
              l.thumbnail AS thumbnail, l.published AS published, l.difficulty AS difficulty,
              l.difficultyEvidence AS difficultyEvidence, l.series AS series, l.episode AS episode,
              l.embeddable AS embeddable, l.hasTranscript AS hasTranscript, l.transcriptNote AS transcriptNote,
              l.source AS source, l.sourceUrl AS sourceUrl, l.license AS license,
              topics, saved, watched, lastWatched, avgRating
       ORDER BY l.published DESC, l.id`,
      { lid: learnerId },
    );
  }

  async kanjiReferences() {
    // reference material (stroke-order PDFs / images) linked to kanji during ingestion
    return this.c.read(
      `MATCH (r:Resource)-[x:REFERENCES]->(k:Kanji)
       RETURN k.id AS kanji, r.id AS resource, r.title AS title, r.path AS path, r.format AS format, x.page AS page`,
    );
  }
}
