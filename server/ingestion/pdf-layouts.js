// Recognise structured study lists inside PDF text (pdftotext -layout output) and turn them into the
// same {row, values} table rows the CSV path produces, so the regular record builders apply.
// Each recogniser checks for its own header/markers first; a PDF that matches none is left to the
// generic text-match handling in files.js. Nothing is guessed: rows that don't fit the layout are skipped.

const HAN = /\p{Script=Han}/u;
const JP = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const KATAKANA = /^[\p{Script=Katakana}ー・.\-、\s]+$/u;
const HIRAGANA = /^[\p{Script=Hiragana}ー・.\-、\s]+$/u;

const cells = (line) => line.trim().split(/\s{2,}/);
const level = (text) => /JLPT\s+(N[1-5])\b/.exec(text)?.[1] || '';

// "to be; to exist; to li…" -> keep the complete "; "-separated parts when the source truncated the text
function untruncate(meaning) {
  if (!/…$/.test(meaning)) return { meaning, truncated: false };
  const parts = meaning.split(/;\s*/);
  return parts.length > 1 ? { meaning: parts.slice(0, -1).join('; '), truncated: true } : { meaning, truncated: true };
}

/** "#  Word  Reading  Meaning" tables (one word per line). */
function wordTable(pages, lvl) {
  if (!/^\s*#\s+Word\s+Reading\s+Meaning\s*$/m.test(pages.join('\n'))) return null;
  const rows = [];
  let truncated = 0;
  pages.forEach((pt, p) => {
    for (const line of pt.split('\n')) {
      const c = cells(line);
      if (c.length !== 4 || !/^\d+$/.test(c[0]) || !JP.test(c[1])) continue;
      const m = untruncate(c[3]);
      if (m.truncated) truncated++;
      rows.push({ row: Number(c[0]), page: p + 1, values: { word: c[1], reading: c[2], meaning: m.meaning, level: lvl } });
    }
  });
  return { kind: 'vocabulary', layout: 'word list (# / word / reading / meaning)', rows, map: { word: 'word', reading: 'reading', meaning: 'meaning', level: 'level' },
    notes: truncated ? [`${truncated} meaning(s) were cut off ("…") in the PDF; kept the complete parts only.`] : [] };
}

/** "#  Kanji  Meaning  On'yomi  Kun'yomi  Strokes" tables. */
function kanjiTable(pages, lvl) {
  if (!/^\s*#\s+Kanji\s+Meaning\s+On'?yomi\s+Kun'?yomi\s+Strokes\s*$/m.test(pages.join('\n'))) return null;
  const rows = [];
  pages.forEach((pt, p) => {
    for (const line of pt.split('\n')) {
      const c = cells(line);
      if (c.length < 4 || !/^\d+$/.test(c[0]) || [...c[1]].length !== 1 || !HAN.test(c[1]) || !/^\d+$/.test(c.at(-1))) continue;
      const values = { kanji: c[1], meaning: c[2], onyomi: '', kunyomi: '', strokes: c.at(-1), level: lvl };
      // readings column(s) may be empty; tell them apart by script rather than by position
      for (const r of c.slice(3, -1)) {
        if (KATAKANA.test(r)) values.onyomi = r; else if (HIRAGANA.test(r)) values.kunyomi = r;
      }
      rows.push({ row: Number(c[0]), page: p + 1, values });
    }
  });
  return { kind: 'kanji', layout: 'kanji list (# / kanji / meaning / on / kun / strokes)', rows,
    map: { kanji: 'kanji', meaning: 'meaning', onyomi: 'onyomi', kunyomi: 'kunyomi', strokes: 'strokes', level: 'level' }, notes: [] };
}

/** Dictionary entries: "word 【reading】 — gloss   0001" (kana-only words have no 【reading】), then a definition, a Japanese example and its translation. */
function glossEntries(pages, lvl) {
  // alternative spellings may be separated by "/" or a space ("見る 観る", "ラジカセ / ラジオカセット")
  const HEAD = /^([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〜～][^【—]*?)(?: 【([^】]+)】)? — (.+?)(?:\s{2,}(\d{1,5}))?\s*$/u;
  if (pages.join('\n').split('\n').filter((l) => HEAD.test(l)).length < 5) return null;
  const rows = [];
  let cur = null;
  pages.forEach((pt, p) => {
    for (const raw of pt.split('\n')) {
      const line = raw.trim();
      const m = HEAD.exec(line);
      if (m) {
        const word = m[1].trim().replace(/\s*\/\s*|\s+/g, '/');
        cur = { row: Number(m[4] || rows.length + 1), page: p + 1, values: { word, reading: m[2] || (HAN.test(word) ? '' : word), meaning: m[3].trim(), definition: '', example: '', exampleEn: '', level: lvl } };
        rows.push(cur);
        continue;
      }
      if (!cur || !line || cur.values.exampleEn || /hanabira\.org|^\S+\s+[A-Z]+–ROW\b/.test(line)) continue;
      if (!cur.values.example && JP.test(line)) cur.values.example = line;
      else if (cur.values.example) cur.values.exampleEn = line;
      else if (!cur.values.definition) cur.values.definition = line;
    }
  });
  return { kind: 'vocabulary', layout: 'dictionary entries (word 【reading】 — gloss + example)', rows,
    map: { word: 'word', reading: 'reading', meaning: 'meaning', definition: 'definition', exampleJp: 'example', exampleEn: 'exampleEn', level: 'level' }, notes: [] };
}

/** Kanji writing sheets: the kanji at the left margin, then its meaning, 音 on'yomi, 訓 kun'yomi and "N strokes". */
function writingSheets(pages, lvl) {
  if (!/^\s+音 \S/m.test(pages.join('\n')) || !/^\s+訓 \S/m.test(pages.join('\n'))) return null;
  const rows = [];
  pages.forEach((pt, p) => {
    const lines = pt.split('\n');
    let cur = null;
    for (const line of lines) {
      const anchor = /^\s{0,3}(\p{Script=Han})(?:\s{2,}(\S.*?))?\s*$/u.exec(line);
      if (anchor) {
        cur = { row: rows.length + 1, page: p + 1, values: { kanji: anchor[1], meaning: '', onyomi: '', kunyomi: '', strokes: '', level: lvl } };
        rows.push(cur);
        if (anchor[2]) cur.values.meaning = anchor[2].split(/\s{2,}/)[0].replace(/\s*·\s*/g, ', ');
        continue;
      }
      if (!cur) continue;
      const t = line.trim();
      let m;
      if ((m = /^音 (.+?)(?:\s{2,}.*)?$/.exec(t))) cur.values.onyomi = m[1].trim();
      else if ((m = /^訓 (.+?)(?:\s{2,}.*)?$/.exec(t))) cur.values.kunyomi = m[1].trim();
      else if (!cur.values.meaning && /^[a-z][^\p{Script=Han}]*$/u.test(t) && !/readings|hanabira/.test(t)) {
        cur.values.meaning = t.split(/\s{2,}/)[0].replace(/\s*·\s*/g, ', ');
      }
      if ((m = /(\d+) strokes?\b/.exec(t))) cur.values.strokes = m[1];
    }
  });
  const ok = rows.filter((r) => r.values.onyomi || r.values.kunyomi);
  if (ok.length < 3) return null;
  return { kind: 'kanji', layout: 'kanji writing sheets (stroke-order pages)', rows: ok, strokeOrder: true,
    map: { kanji: 'kanji', meaning: 'meaning', onyomi: 'onyomi', kunyomi: 'kunyomi', strokes: 'strokes', level: 'level' }, notes: [] };
}

/** Kana practice pages labelled with the character's Unicode code point ("Search code: 3042" = あ). */
function kanaCodePages(pages) {
  const refs = [];
  pages.forEach((pt, p) => {
    const m = /Search code:\s*([0-9A-F]{4})\b/.exec(pt);
    if (!m) return;
    const ch = String.fromCodePoint(Number.parseInt(m[1], 16));
    if (/^[\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(ch)) refs.push({ conceptId: `kana:${ch}`, page: p + 1, flags: ['codepoint_label'] });
  });
  return refs.length >= 5 ? { kind: 'kana-reference', layout: 'kana stroke-order pages (code point labels)', rows: [], refs, notes: [] } : null;
}

/**
 * @param {string} text pdftotext -layout output (pages separated by \f)
 * @returns {null | {kind, layout, rows, map?, refs?, strokeOrder?, notes}}
 */
export function parsePdfLayout(text) {
  const pages = text.split('\f');
  const lvl = level(text);
  for (const fn of [wordTable, kanjiTable, glossEntries, writingSheets]) {
    const out = fn(pages, lvl);
    if (out && out.rows.length) return out;
  }
  return kanaCodePages(pages);
}
