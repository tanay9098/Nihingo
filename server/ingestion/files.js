// File discovery + per-format handlers. Each handler inspects the real file and returns a
// normalised result; unsupported or broken files never throw out of `handleFile`.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseTable } from './csv.js';
import { classifyTable, classifyObjects } from './mapping.js';
import { vocabularyRecord, kanjiRecord, kanaRecord, grammarRecord, grammarRowRecord, exerciseRecord } from './records.js';
import { parsePdfLayout } from './pdf-layouts.js';

const run = promisify(execFile);
const SKIP = new Set(['sources.json', 'README.md', '.gitkeep']);
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const AUDIO = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.mp4', '.webm']);
const TEXT = new Set(['.md', '.txt']);

export async function scanDir(root) {
  const out = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') || SKIP.has(e.name) && dir === root) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.isFile()) out.push(abs);
    }
  }
  await walk(root);
  return out;
}

export async function describeFile(abs, root) {
  const buf = await readFile(abs);
  const st = await stat(abs);
  return {
    abs, rel: path.relative(root, abs).split(path.sep).join('/'), ext: path.extname(abs).toLowerCase(),
    size: st.size, checksum: createHash('sha256').update(buf).digest('hex'), buf,
  };
}

export function provenanceFor(rel, sources) {
  const rule = (sources.rules || []).find((r) => rel.startsWith(r.prefix));
  return rule || sources.default || { source: 'unknown', license: 'unknown', origin: 'local', url: '' };
}

const empty = () => ({ concepts: { vocabulary: [], kanji: [], kana: [], grammar: [] }, exercises: [], lessons: [], refs: [], notes: [], skipped: 0, flagged: 0 });

function fromTable(kind, map, rows, res) {
  const builders = { vocabulary: vocabularyRecord, kanji: kanjiRecord, kana: kanaRecord, grammar: grammarRowRecord };
  const seen = new Set();
  rows.forEach((row, i) => {
    const rec = builders[kind](row, map, i);
    if (rec.skip) { res.skipped++; res.notes.push(`row ${row.row}: skipped (${rec.skip})`); return; }
    if (seen.has(rec.id)) { res.skipped++; res.notes.push(`row ${row.row}: duplicate of ${rec.id}, skipped`); return; }
    seen.add(rec.id);
    if (rec.flags.length) { res.flagged++; res.notes.push(`row ${row.row}: ${rec.flags.join(', ')}`); }
    res.concepts[kind].push(rec);
  });
}

function fromObjects(objs, res) {
  const cls = classifyObjects(objs);
  res.detected = cls.kind;
  if (cls.kind === 'grammar' && cls.table) {
    fromTable('grammar', cls.map, cls.rows, res);
  } else if (cls.kind === 'grammar') {
    objs.forEach((o, i) => {
      const rec = grammarRecord(o, i, i + 1);
      if (rec.skip) { res.skipped++; res.notes.push(`item ${i + 1}: skipped (${rec.skip})`); return; }
      if (rec.flags.length) { res.flagged++; res.notes.push(`item ${i + 1}: ${rec.flags.join(', ')}`); }
      res.concepts.grammar.push(rec);
    });
  } else if (cls.kind === 'exercise') {
    objs.forEach((o, i) => {
      const rec = exerciseRecord(o, i + 1);
      if (rec.skip) { res.skipped++; res.notes.push(`item ${i + 1}: skipped (${rec.skip})`); return; }
      if (rec.flags.length) { res.flagged++; res.notes.push(`item ${i + 1}: ${rec.flags.join(', ')}`); }
      res.exercises.push(rec);
    });
  } else if (['vocabulary', 'kanji', 'kana'].includes(cls.kind)) {
    fromTable(cls.kind, cls.map, cls.rows, res);
  }
  return cls.kind;
}

async function pdfHandler(f, ctx, res) {
  let pages = 0;
  try {
    const info = await run('pdfinfo', [f.abs], { timeout: 15000 });
    pages = Number(/Pages:\s+(\d+)/.exec(info.stdout)?.[1] || 0);
  } catch (err) {
    if (err.code === 'ENOENT') { res.notes.push('pdfinfo/pdftotext not installed: stored as a linked file only.'); res.status = 'linked'; return; }
    res.notes.push(`PDF could not be read (${(err.stderr || err.message).toString().split('\n')[0]}).`);
    res.status = 'unparsed';
    return;
  }
  res.meta = { pages };
  let text = '';
  try { text = (await run('pdftotext', ['-layout', f.abs, '-'], { timeout: 30000, maxBuffer: 32 * 1024 * 1024 })).stdout; } catch (err) {
    res.notes.push(`Text extraction failed: ${err.message.split('\n')[0]}`);
  }
  if (!text.trim()) {
    res.status = 'linked';
    res.notes.push('No extractable text (likely scanned or image-only). Linked as a visual reference; inspect pages manually.');
    return;
  }
  res.meta.textChars = text.length;
  const layout = parsePdfLayout(text);
  if (layout) {
    // a structured study list: parse its rows like a table instead of only linking kanji by text match
    res.detected = layout.kind;
    res.meta.layout = layout.layout;
    if (layout.rows.length) fromTable(layout.kind, layout.map, layout.rows.map((r) => ({ ...r, row: `${r.row}, page ${r.page}` })), res);
    if (layout.strokeOrder) {
      for (const r of layout.rows) res.refs.push({ conceptId: `k:${r.values.kanji}`, page: r.page, loc: 'stroke-order page', flags: ['layout_match'] });
    }
    for (const r of layout.refs || []) res.refs.push({ ...r, loc: 'stroke-order page' });
    res.notes.unshift(`Recognised layout: ${layout.layout}; ${layout.rows.length ? `${layout.rows.length} entries parsed` : `${res.refs.length} pages linked`} from ${pages || text.split('\f').length} page(s).`, ...layout.notes);
    res.status = res.skipped ? 'partial' : 'indexed';
    return;
  }
  const known = ctx.knownKanji;
  const pageTexts = text.split('\f');
  pageTexts.forEach((pt, i) => {
    const found = [...new Set([...pt].filter((ch) => known.has(ch)))];
    if (found.length && found.length <= 12) {
      for (const ch of found) res.refs.push({ conceptId: `k:${ch}`, page: i + 1, flags: ['text_match'] });
    }
  });
  res.status = 'partial';
  res.notes.push(`Extracted text from ${pages || pageTexts.length} page(s); linked ${res.refs.length} kanji↔page references by text match (stroke-order data itself is NOT parsed).`);
}

function imageHandler(f, ctx, res) {
  const b = f.buf;
  const sig = b.subarray(0, 4).toString('hex');
  const okSig = { '.png': '89504e47', '.jpg': 'ffd8ffe0', '.jpeg': 'ffd8ffe0' };
  if (okSig[f.ext] && !(sig === okSig[f.ext] || (f.ext !== '.png' && sig.startsWith('ffd8ff')))) {
    res.status = 'unparsed'; res.notes.push('File signature does not match its extension.'); return;
  }
  const stem = path.basename(f.rel, f.ext);
  const chars = [...stem].filter((ch) => ctx.knownKanji.has(ch));
  if (chars.length && chars.length <= 3) {
    for (const ch of chars) res.refs.push({ conceptId: `k:${ch}`, page: 0, flags: ['filename_match'] });
    res.notes.push(`Linked to kanji by file name: ${chars.join(' ')}.`);
  } else res.notes.push('Image stored as a linked resource (no kanji in file name to link).');
  res.status = 'linked';
}

const HANDLERS = {
  '.csv': (f, ctx, res) => tableHandler(f, res),
  '.tsv': (f, ctx, res) => tableHandler(f, res),
  '.json': (f, ctx, res) => jsonHandler(f, res),
  '.jsonl': (f, ctx, res) => jsonlHandler(f, res),
  '.pdf': pdfHandler,
};

function tableHandler(f, res) {
  const { headers, records } = parseTable(f.buf.toString('utf8'));
  res.meta = { headers, rows: records.length };
  if (!records.length) { res.status = 'unparsed'; res.notes.push('Table has no data rows.'); return; }
  const cls = classifyTable(headers, records);
  res.detected = cls.kind;
  if (cls.kind === 'unrecognized') {
    res.status = 'unparsed';
    res.notes.push(`Columns [${headers.join(', ')}] do not match vocabulary / kanji / kana / exercise / grammar layouts; linked as a file only.`);
    return;
  }
  if ((cls.kind === 'grammar' && !cls.table) || cls.kind === 'exercise') {
    fromObjects(records.map((r) => r.values), res);
  } else fromTable(cls.kind, cls.map, records, res);
  res.status = 'indexed';
}

function jsonHandler(f, res) {
  const data = JSON.parse(f.buf.toString('utf8'));
  if (data && Array.isArray(data.videos) && data.videos.every((v) => v.videoId)) {
    res.detected = 'listening-catalog';
    res.meta = { source: data.source?.name, verifiedAt: data.verifiedAt, videos: data.videos.length };
    for (const v of data.videos) {
      res.lessons.push({
        id: `lesson:yt:${v.videoId}`,
        props: {
          kind: 'listening', videoId: v.videoId, title: v.title, url: v.url, embedUrl: v.embedUrl, thumbnail: v.thumbnail,
          published: v.published, series: v.series, episode: v.episode ?? -1, difficulty: v.difficulty || 'unknown',
          difficultyEvidence: v.difficultyEvidence || 'unknown', embeddable: v.embeddable === true,
          embeddableChecked: v.embeddable !== null && v.embeddable !== undefined,
          hasTranscript: !!v.transcript, transcriptNote: v.transcriptNote || '',
          source: data.source?.name || 'unknown', sourceUrl: data.source?.youtubeChannel || data.source?.website || '', license: data.license || '',
        },
        topics: v.topics || [], flags: [], loc: v.videoId,
      });
    }
    res.status = 'indexed';
    return;
  }
  const objs = Array.isArray(data) ? data : null;
  if (!objs || !objs.every((o) => o && typeof o === 'object')) { res.status = 'unparsed'; res.notes.push('JSON is not an array of objects or a known catalog.'); return; }
  res.meta = { items: objs.length };
  const kind = fromObjects(objs, res);
  if (kind === 'unrecognized') { res.status = 'unparsed'; res.notes.push('Object keys do not match a known layout; linked as a file only.'); return; }
  res.status = 'indexed';
}

function jsonlHandler(f, res) {
  const objs = [];
  f.buf.toString('utf8').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try { objs.push(JSON.parse(line)); } catch { res.notes.push(`line ${i + 1}: invalid JSON, skipped`); res.skipped++; }
  });
  res.meta = { items: objs.length };
  if (!objs.length) { res.status = 'unparsed'; res.notes.push('No valid JSON lines.'); return; }
  const kind = fromObjects(objs, res);
  if (kind === 'unrecognized') { res.status = 'unparsed'; res.notes.push('Object keys do not match a known layout; linked as a file only.'); return; }
  res.status = res.skipped ? 'partial' : 'indexed';
}

export async function handleFile(f, ctx) {
  const res = { ...empty(), status: 'indexed', format: f.ext.slice(1) || 'unknown', meta: {} };
  try {
    if (HANDLERS[f.ext]) await HANDLERS[f.ext](f, ctx, res);
    else if (IMAGE.has(f.ext)) { res.format = 'image'; imageHandler(f, ctx, res); }
    else if (AUDIO.has(f.ext)) { res.format = 'audio/video'; res.status = 'linked'; res.notes.push('Audio/video is linked only: not transcribed, not redistributed.'); }
    else if (TEXT.has(f.ext)) {
      const text = f.buf.toString('utf8');
      const title = /^#\s+(.+)$/m.exec(text)?.[1] || '';
      res.meta = { lines: text.split('\n').length, title };
      res.status = 'linked';
      res.notes.push('Text/Markdown document stored as a reference; not split into concepts automatically.');
    } else { res.status = 'unparsed'; res.notes.push(`Unsupported extension "${f.ext || '(none)'}".`); }
  } catch (err) {
    res.status = 'unparsed';
    res.notes.push(`Parse error: ${err.message}`);
  }
  return res;
}
