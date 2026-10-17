// Inspect the *actual* columns/keys of a data file and decide what kind of records it holds.
// Nothing here assumes a fixed schema: header names are matched against alias lists, and the
// decision is confirmed by looking at the values.

const ALIASES = {
  word: ['word', 'vocab', 'vocabulary', 'japanese', 'expression', 'term', 'headword', 'kanji_word', '単語', '表記'],
  kanji: ['kanji', 'character', 'kanji_char', '漢字'],
  char: ['char', 'kana', 'glyph', 'symbol', 'character'],
  reading: ['reading', 'kana_reading', 'hiragana', 'furigana', 'yomi', 'pronunciation', '読み', 'よみ'],
  romaji: ['romaji', 'rōmaji', 'romanization', 'romanisation', 'roumaji'],
  meaning: ['meaning', 'meanings', 'english', 'translation', 'definition', 'gloss', '意味'],
  definition: ['definition', 'english_definition'],   // only used as its own field when a separate meaning column exists
  pos: ['pos', 'part_of_speech', 'type_of_word', 'wordtype'],
  topic: ['topic', 'topics', 'tag', 'tags', 'category', 'categories', 'theme', 'group', 'lesson'],
  level: ['level', 'jlpt', 'jlpt_level', 'difficulty'],
  exampleJp: ['example_jp', 'example', 'sentence', 'example_sentence', 'example_japanese', '例文'],
  exampleReading: ['example_reading', 'sentence_reading', 'example_kana'],
  exampleEn: ['example_en', 'example_translation', 'sentence_translation', 'example_english'],
  exampleRomaji: ['example_romaji', 'sentence_romaji'],
  grammar: ['grammar_point', 'grammar', 'grammar_pattern', '文法'],
  pattern: ['pattern', 'formation', 'structure', 'construction', '接続'],
  explanation: ['explanation', 'usage', 'description', '説明'],
  onyomi: ['onyomi', 'on', "on'yomi", 'on_reading', '音読み'],
  kunyomi: ['kunyomi', 'kun', "kun'yomi", 'kun_reading', '訓読み'],
  strokes: ['strokes', 'stroke_count', 'stroke', 'strokecount', '画数'],
  script: ['script', 'kana_type', 'syllabary'],
  note: ['jlpt_note', 'note', 'notes', 'comment'],
};

// "Example (Japanese)" -> "example_japanese", so spreadsheet-style headers match the snake_case aliases.
const normHeader = (h) => h.toLowerCase().trim().replace(/[\s()\-]+/g, '_').replace(/^_+|_+$/g, '');

export function columnMap(headers) {
  const lower = headers.map(normHeader);
  const map = {};
  for (const [role, names] of Object.entries(ALIASES)) {
    const idx = lower.findIndex((h) => names.includes(h));
    if (idx >= 0) map[role] = headers[idx];
  }
  return map;
}

const CJK = /^[㐀-鿿]$/u;
const KANA1 = /^[぀-ヿー]$/u;

export function classifyTable(headers, rows) {
  const map = columnMap(headers);
  const lower = new Set(headers.map((h) => h.toLowerCase()));
  const col = (role) => map[role];
  const sample = (name) => rows.slice(0, 50).map((r) => r.values[name]).filter(Boolean);
  const ratio = (name, re) => { const s = sample(name); return s.length ? s.filter((v) => re.test(v)).length / s.length : 0; };

  const kanjiCol = col('kanji');
  if (kanjiCol && ratio(kanjiCol, CJK) >= 0.8 && (col('onyomi') || col('kunyomi') || col('strokes') || col('meaning'))) {
    return { kind: 'kanji', map: { ...map, kanji: kanjiCol } };
  }
  const charCol = col('char');
  if (charCol && col('romaji') && !col('meaning') && ratio(charCol, KANA1) >= 0.8) {
    return { kind: 'kana', map: { ...map, char: charCol } };
  }
  const wordCol = col('word') || (kanjiCol && ratio(kanjiCol, CJK) < 0.8 ? kanjiCol : undefined);
  if (wordCol && (col('reading') || col('meaning'))) return { kind: 'vocabulary', map: { ...map, word: wordCol } };
  if (lower.has('type') && lower.has('answer') && (lower.has('prompt') || lower.has('question'))) return { kind: 'exercise', map };
  if ((lower.has('pattern') || lower.has('explanation')) && (lower.has('name') || lower.has('id'))) return { kind: 'grammar', map };
  // spreadsheet layout: one grammar point per row ("Grammar Point", "Meaning", "Formation", examples…)
  if (col('grammar') && (col('pattern') || col('meaning') || col('explanation'))) return { kind: 'grammar', map, table: true };
  return { kind: 'unrecognized', map };
}

export function classifyObjects(objs) {
  if (!objs.length) return { kind: 'unrecognized' };
  const headers = [...new Set(objs.flatMap((o) => Object.keys(o)))];
  const rows = objs.map((o, i) => ({ row: i + 1, values: Object.fromEntries(headers.map((h) => [h, o[h] == null ? '' : typeof o[h] === 'object' ? JSON.stringify(o[h]) : String(o[h])])) }));
  return { ...classifyTable(headers, rows), headers, rows };
}
