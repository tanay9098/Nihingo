import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tryConnect, bootstrap, teardown } from './helpers.js';
import { ingestResources } from '../server/ingestion/ingest.js';
import { CatalogStore } from '../server/graph/catalog.js';

const client = await tryConnect();
const skip = client ? false : 'FalkorDB is not reachable (set FALKORDB_HOST/FALKORDB_PORT)';
let env;
const count = async (cypher) => (await client.query(cypher))[0].n;

test('ingestion: real resources are discovered, parsed with their actual schema and indexed', { skip }, async () => {
  env = await bootstrap(client, { seed: false });
  const byPath = Object.fromEntries(env.report.files.map((f) => [f.path, f]));
  assert.equal(byPath['original/vocabulary.csv'].detected, 'vocabulary');
  assert.equal(byPath['original/vocabulary.csv'].counts.vocabulary, 56);
  assert.equal(byPath['original/kanji.csv'].counts.kanji, 26);
  assert.equal(byPath['original/kana.json'].counts.kana, 92);
  assert.equal(byPath['original/grammar.json'].counts.grammar, 16);
  assert.equal(byPath['original/exercises.jsonl'].detected, 'exercise');
  assert.equal(byPath['external/lazybenkyou_videos.json'].detected, 'listening-catalog');
  for (const f of env.report.files) assert.match(f.checksum, /^[0-9a-f]{64}$/);
  assert.equal(await count("MATCH (:Resource {id: 'res:original/vocabulary.csv'})-[:CONTAINS]->(v:Vocabulary) RETURN count(v) AS n"), 56);
  // provenance is preserved on the Resource nodes
  const r = (await client.query("MATCH (r:Resource {id: 'res:original/vocabulary.csv'}) RETURN r.source AS s, r.license AS l, r.origin AS o"))[0];
  assert.equal(r.o, 'original'); assert.match(r.l, /MIT/);
  const lb = (await client.query("MATCH (r:Resource {id: 'res:external/lazybenkyou_videos.json'}) RETURN r.license AS l, r.url AS u"))[0];
  assert.match(lb.l, /Lazy Benkyou/); assert.equal(lb.u, 'https://lazybenkyou.com/');
  // kanji -> vocabulary relationships come from the data
  assert.ok(await count("MATCH (:Kanji {char: '食'})-[:APPEARS_IN]->(:Vocabulary {word: '食べる'}) RETURN count(*) AS n") === 1);
});

test('ingestion: re-running (and --force) never duplicates nodes or relationships', { skip }, async () => {
  const snapshot = async () => [await count('MATCH (n) RETURN count(n) AS n'), await count('MATCH ()-[r]->() RETURN count(r) AS n')];
  const before = await snapshot();
  const again = await ingestResources({ catalog: env.catalog, client, dir: (await import('../server/config.js')).config.resourcesDir });
  assert.equal(again.totals.unchanged, again.totals.files);       // incremental: nothing re-parsed
  assert.deepEqual(await snapshot(), before);
  await ingestResources({ catalog: env.catalog, client, dir: (await import('../server/config.js')).config.resourcesDir, force: true });
  assert.deepEqual(await snapshot(), before);                      // forced: MERGE keeps counts identical
});

test('ingestion: unsupported, broken and unrecognised files fail gracefully; local files get unknown license', { skip }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'res-'));
  try {
    await writeFile(path.join(dir, 'weird.xyz'), 'whatever');
    await writeFile(path.join(dir, 'unknown_columns.csv'), 'foo,bar\n1,2\n');
    await writeFile(path.join(dir, 'broken_quotes.csv'), 'word,reading,meaning\n"oops,1,2\n');
    await writeFile(path.join(dir, 'bad.json'), '{not json');
    await writeFile(path.join(dir, 'notes.md'), '# My notes\nhello');
    await writeFile(path.join(dir, 'audio.mp3'), Buffer.from([1, 2, 3]));
    await writeFile(path.join(dir, '日.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    await writeFile(path.join(dir, 'fake.png'), 'not a png');
    await cp('tests/fixtures/broken.pdf', path.join(dir, 'broken.pdf'));
    await writeFile(path.join(dir, 'ok.csv'), 'word,reading,meaning\nねこ,ねこ,cat\n,,\n');
    const report = await ingestResources({ catalog: new CatalogStore(client), client, dir });
    const s = Object.fromEntries(report.files.map((f) => [f.path, f]));
    assert.equal(s['weird.xyz'].status, 'unparsed');
    assert.equal(s['unknown_columns.csv'].status, 'unparsed');
    assert.equal(s['broken_quotes.csv'].status, 'unparsed');
    assert.equal(s['bad.json'].status, 'unparsed');
    assert.equal(s['fake.png'].status, 'unparsed');
    assert.equal(s['broken.pdf'].status === 'unparsed' || s['broken.pdf'].status === 'linked', true);
    assert.equal(s['notes.md'].status, 'linked');
    assert.equal(s['audio.mp3'].status, 'linked');
    assert.equal(s['日.png'].status, 'linked');
    assert.equal(s['ok.csv'].counts.vocabulary, 1);                 // the empty row is skipped, not fatal
    assert.match(s['ok.csv'].provenance.license, /Unknown/);
    // the picture named after a known kanji is linked to it (image resources stay as files, not graph properties)
    assert.equal(await count("MATCH (:Resource {path: '日.png'})-[:REFERENCES]->(:Kanji {char: '日'}) RETURN count(*) AS n"), 1);
    // a file removed from disk is flagged missing, not silently kept as indexed
    await rm(path.join(dir, 'ok.csv'));
    await ingestResources({ catalog: new CatalogStore(client), client, dir });
    assert.equal((await client.query("MATCH (r:Resource {path: 'ok.csv'}) RETURN r.status AS s"))[0].s, 'missing');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ingestion: PDF text is extracted and kanji are linked to the pages they appear on (dense pages are skipped)', { skip: skip || (spawnSync('pdftotext', ['-v']).error ? 'pdftotext (poppler-utils) is not installed' : false) }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pdf-'));
  try {
    await cp('tests/fixtures/kanji-sample.pdf', path.join(dir, 'kanji-sample.pdf'));
    const report = await ingestResources({ catalog: new CatalogStore(client), client, dir });
    const f = report.files[0];
    assert.equal(f.status, 'partial'); assert.equal(f.meta.pages, 3);
    const rows = await client.query("MATCH (:Resource {path: 'kanji-sample.pdf'})-[x:REFERENCES]->(k:Kanji) RETURN k.char AS k, x.page AS p ORDER BY p, k");
    assert.deepEqual(rows.map((r) => `${r.k}@${r.p}`), ['日@1', '月@1', '水@1', '食@2']);   // page 3 lists 26 kanji: too dense to be a reference page
    assert.match(f.notes[0], /stroke-order data itself is NOT parsed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ingestion: a local file never overwrites a concept another resource defined; it only fills empty fields', { skip }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'overlap-'));
  try {
    // ぬえぬえ is a made-up word, so it never collides with a real list in resources/local/
    await writeFile(path.join(dir, 'n5.csv'), 'word,reading,meaning,level\n水,すい,WRONG,N5\nぬえぬえ,ぬえぬえ,test word,N4\n');
    const report = await ingestResources({ catalog: new CatalogStore(client), client, dir });
    assert.equal(report.files[0].counts.vocabulary, 2);
    assert.equal(report.files[0].counts.exercises, 4);              // exercises only for the new (kana-only) word
    const w = (await client.query("MATCH (v:Vocabulary {id: 'v:水'}) RETURN v.meaning AS m, v.reading AS r, v.level AS l, v.primarySource AS s"))[0];
    assert.equal(w.m, 'water'); assert.equal(w.r, 'みず'); assert.equal(w.s, 'res:original/vocabulary.csv');
    assert.equal(w.l, 'unknown');                                    // a level is one source's claim: never copied onto another's concept
    // empty fields are filled and become searchable: b.csv supplies the meaning a.csv left empty
    await writeFile(path.join(dir, 'a.csv'), 'word,reading\nぴよぴよ,ぴよぴよ\n');
    await writeFile(path.join(dir, 'b.csv'), 'word,reading,meaning\nぴよぴよ,ぴよぴよ,chirp\n');
    await ingestResources({ catalog: new CatalogStore(client), client, dir });
    assert.match((await client.query("MATCH (v:Vocabulary {id: 'v:ぴよぴよ'}) RETURN v.search AS q"))[0].q, /chirp/);
    assert.equal((await client.query("MATCH (e:Exercise {id: 'ex:vocab:mc_meaning:v:水'}) RETURN e.answer AS a"))[0].a, 'water');
    assert.equal(await count("MATCH (:Resource {path: 'n5.csv'})-[:CONTAINS]->(:Vocabulary {id: 'v:水'}) RETURN count(*) AS n"), 1);
    // new local material is planned after the curated original content
    assert.ok((await client.query("MATCH (v:Vocabulary {id: 'v:ぬえぬえ'}) RETURN v.order AS o"))[0].o >= 100000);
    // the ownership note is stored on the Resource node, not only in the report
    assert.match((await client.query("MATCH (r:Resource {path: 'n5.csv'}) RETURN r.notes AS n"))[0].n, /already defined by another resource/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ingestion: schema initialisation is repeatable', { skip }, async () => {
  const { ensureSchema } = await import('../server/graph/schema.js');
  assert.equal((await ensureSchema(client)).length, 0);
});

test('teardown', { skip }, async () => { if (client) await teardown(client); });
