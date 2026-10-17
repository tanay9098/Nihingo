// Resource ingestion pipeline: scan -> checksum -> inspect/parse -> write idempotently to FalkorDB.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { scanDir, describeFile, handleFile, provenanceFor } from './files.js';
import { vocabularyExercises, kanaExercises, kanjiExercises } from './exercises.js';

const ORDER = { '.csv': 0, '.tsv': 0, '.json': 1, '.jsonl': 2, '.pdf': 8 };
const rank = (abs) => ORDER[path.extname(abs).toLowerCase()] ?? 5;

async function loadSources(dir) {
  const fallback = { source: 'Local resource (user-supplied)', license: 'Unknown — kept local and never redistributed by this app.', origin: 'local', url: '' };
  try {
    const j = JSON.parse(await readFile(path.join(dir, 'sources.json'), 'utf8'));
    return { rules: j.rules || [], default: j.default || fallback };
  } catch { return { rules: [], default: fallback }; }
}

/**
 * @param {{catalog: import('../graph/catalog.js').CatalogStore, client: any, dir: string, force?: boolean, log?: Function}} opts
 */
export async function ingestResources({ catalog, client, dir, force = false, log = () => {} }) {
  const sources = await loadSources(dir);
  const files = (await scanDir(dir)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const knownKanji = new Set((await client.query('MATCH (k:Kanji) RETURN k.char AS c')).map((r) => r.c));
  const report = { dir, startedAt: new Date().toISOString(), files: [], totals: { files: files.length, indexed: 0, partial: 0, linked: 0, unparsed: 0, unchanged: 0 } };
  const seen = [];
  let changed = false;

  for (const abs of files) {
    const f = await describeFile(abs, dir);
    const id = `res:${f.rel}`;
    seen.push(id);
    const prov = provenanceFor(f.rel, sources);
    const prev = await catalog.getResourceChecksum(id);
    if (!force && prev && prev.checksum === f.checksum && prev.status !== 'error') {
      report.files.push({ path: f.rel, format: f.ext.slice(1), size: f.size, checksum: f.checksum, status: 'unchanged', prevStatus: prev.status, provenance: prov, notes: [] });
      report.totals.unchanged++;
      continue;
    }
    changed = true;
    const res = await handleFile(f, { knownKanji });
    log(`  ${f.rel}: ${res.status}${res.detected ? ` (${res.detected})` : ''}`);

    await catalog.upsertResource({
      id,
      props: {
        title: res.meta?.title || path.basename(f.rel), path: f.rel, format: res.format, kind: res.detected || res.format,
        size: f.size, checksum: f.checksum, status: res.status, source: prov.source, license: prov.license,
        origin: prov.origin, url: prov.url || '', notes: res.notes.slice(0, 8).join(' | ').slice(0, 1200),
        flagged: res.flagged, skipped: res.skipped,
      },
    });

    // concepts
    for (const kind of ['vocabulary', 'kanji', 'kana', 'grammar']) {
      const recs = res.concepts[kind];
      if (!recs.length) continue;
      await catalog.upsertConcepts(kind, recs.map((r) => ({ id: r.id, props: r.props })));
      await catalog.linkResource(id, recs.map((r) => ({ id: r.id, loc: r.loc, flags: r.flags })), kind === 'grammar' ? 'EXPLAINS' : 'CONTAINS');
      await catalog.tagTopics(recs.map((r) => ({ id: r.id, topics: r.topics })));
      if (kind === 'kanji') recs.forEach((r) => knownKanji.add(r.props.char));
    }
    // grammar relationships
    const gram = res.concepts.grammar;
    if (gram.length) {
      await catalog.linkPairs('REQUIRES', gram.flatMap((g) => g.requires.map((to) => ({ from: g.id, to }))));
      await catalog.linkPairs('CONTRASTS_WITH', gram.flatMap((g) => g.contrasts.map((to) => ({ from: g.id, to }))));
    }
    // exercises: authored ones from the file + mechanically generated ones from vocab/kana/kanji rows
    const gen = [
      ...vocabularyExercises(res.concepts.vocabulary),
      ...kanaExercises(res.concepts.kana),
      ...kanjiExercises(res.concepts.kanji),
    ];
    const exercises = [...res.exercises.map((e) => ({ id: e.id, conceptId: e.conceptId, props: e.props })), ...gen];
    if (exercises.length) {
      await catalog.upsertExercises(exercises);
      await catalog.linkResource(id, exercises.map((e) => ({ id: e.id, loc: 'generated', flags: [] })), 'CONTAINS');
    }
    // listening lessons
    if (res.lessons.length) {
      await catalog.upsertLessons(res.lessons.map((l) => ({ id: l.id, props: l.props })));
      await catalog.linkResource(id, res.lessons.map((l) => ({ id: l.id, loc: l.loc, flags: l.flags })), 'CONTAINS');
      await catalog.tagTopics(res.lessons.map((l) => ({ id: l.id, topics: l.topics })), 'Lesson');
    }
    // reference material (stroke-order PDFs/images) -> kanji
    if (res.refs.length) {
      await catalog.linkResource(id, res.refs.map((r) => ({ id: r.conceptId, loc: 'text match', flags: r.flags, page: r.page })), 'REFERENCES');
    }

    const entry = {
      path: f.rel, format: res.format, size: f.size, checksum: f.checksum, status: res.status, detected: res.detected || '',
      provenance: prov, meta: res.meta,
      counts: {
        vocabulary: res.concepts.vocabulary.length, kanji: res.concepts.kanji.length, kana: res.concepts.kana.length,
        grammar: res.concepts.grammar.length, exercises: exercises.length, lessons: res.lessons.length, references: res.refs.length,
      },
      flagged: res.flagged, skipped: res.skipped, notes: res.notes,
    };
    report.files.push(entry);
    report.totals[res.status] = (report.totals[res.status] || 0) + 1;
  }

  // Kanji -> vocabulary that contains them (semantic relationship derived from the data itself)
  if (changed || force) {
    const kanji = await client.query('MATCH (k:Kanji) RETURN k.id AS id, k.char AS ch');
    const vocab = await client.query("MATCH (v:Vocabulary) WHERE v.hasKanji = true RETURN v.id AS id, v.word AS word");
    const pairs = [];
    for (const v of vocab) for (const k of kanji) if (v.word.includes(k.ch)) pairs.push({ from: k.id, to: v.id });
    await catalog.linkPairs('APPEARS_IN', pairs);
    report.derived = { kanjiAppearsIn: pairs.length };
  }
  // files that disappeared from disk
  await client.query("MATCH (r:Resource) WHERE NOT r.id IN $seen AND r.status <> 'missing' SET r.status = 'missing'", { seen });
  report.finishedAt = new Date().toISOString();
  return report;
}
