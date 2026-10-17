// Turn raw table rows into normalised concept records, flagging anything uncertain.
import { toHiragana } from '../agents/grade.js';

const splitList = (s) => String(s || '').split(/[,;|]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
const HAS_KANJI = /[㐀-鿿]/u;
// "JLPT N5" / "jlpt n5" / "N5" -> "N5", so every source uses the same label; anything else is kept as written
const normLevel = (s) => { const t = String(s || '').trim(); return /^(jlpt\s*)?n[1-5]$/i.test(t) ? t.slice(-2).toUpperCase() : t || 'unknown'; };

const searchText = (...parts) => parts.flat().filter(Boolean).map((p) => String(p).normalize('NFKC').toLowerCase()).join(' ');

/** Search text for a concept's properties; also rebuilt when another resource fills in empty fields. */
export function conceptSearch(kind, p) {
  if (kind === 'vocabulary') return searchText(p.word, p.reading, toHiragana(p.reading || ''), p.romaji, p.meaning, p.tags, p.pos, 'vocabulary');
  if (kind === 'kanji') return searchText(p.char, p.meaning, p.onyomi, p.kunyomi, toHiragana(p.kunyomi || ''), 'kanji');
  if (kind === 'kana') return searchText(p.char, toHiragana(p.char), p.romaji, p.script, 'kana');
  return searchText(p.name, p.pattern, p.explanation, p.tags, 'grammar');
}

export function vocabularyRecord(row, map, order) {
  const v = (role) => (map[role] ? row.values[map[role]] : '');
  const word = v('word');
  const flags = [];
  if (!word) return { skip: 'no word', flags: ['missing_word'] };
  const reading = v('reading') || (HAS_KANJI.test(word) ? '' : word);
  if (!reading) flags.push('missing_reading');
  if (!v('meaning')) flags.push('missing_meaning');
  const tags = splitList(v('topic'));
  const props = {
    word, reading, romaji: v('romaji').toLowerCase(), meaning: v('meaning'), definition: v('definition'), pos: v('pos'),
    example: v('exampleJp'), exampleReading: v('exampleReading'), exampleMeaning: v('exampleEn'),
    tags, level: normLevel(v('level')), hasKanji: HAS_KANJI.test(word), order,
    flagged: flags.length > 0,
  };
  return {
    id: `v:${word}`,
    props: { ...props, search: conceptSearch('vocabulary', props) },
    topics: tags, flags, loc: `row ${row.row}`,
  };
}

export function kanjiRecord(row, map, order) {
  const v = (role) => (map[role] ? row.values[map[role]] : '');
  const char = v('kanji');
  if (!char) return { skip: 'no kanji', flags: ['missing_kanji'] };
  const flags = [];
  const strokesRaw = v('strokes');
  const strokes = Number.parseInt(strokesRaw, 10);
  if (strokesRaw && !Number.isFinite(strokes)) flags.push('bad_stroke_count');
  if (!v('meaning')) flags.push('missing_meaning');
  const props = {
    char, meaning: v('meaning'), onyomi: v('onyomi'), kunyomi: v('kunyomi'),
    strokes: Number.isFinite(strokes) ? strokes : -1, level: normLevel(v('level')), order, flagged: flags.length > 0,
  };
  return {
    id: `k:${char}`,
    props: { ...props, search: conceptSearch('kanji', props) },
    topics: [], flags, loc: `row ${row.row}`,
  };
}

export function kanaRecord(row, map, order) {
  const v = (role) => (map[role] ? row.values[map[role]] : '');
  const char = v('char');
  if (!char) return { skip: 'no char', flags: ['missing_char'] };
  const script = v('script') || (/[゠-ヿ]/.test(char) ? 'katakana' : 'hiragana');
  return {
    id: `kana:${char}`,
    props: { char, romaji: v('romaji').toLowerCase(), script, row: row.values.row || '', order, flagged: false,
      search: conceptSearch('kana', { char, romaji: v('romaji'), script }) },
    topics: [script], flags: [], loc: `row ${row.row}`,
  };
}

export function grammarRecord(obj, order, row) {
  const flags = [];
  if (!obj.id || !obj.name) return { skip: 'no id/name', flags: ['missing_id'] };
  if (!obj.explanation) flags.push('missing_explanation');
  const ex = Array.isArray(obj.examples) ? obj.examples[0] : null;
  return {
    id: obj.id,
    props: {
      name: obj.name, pattern: obj.pattern || '', explanation: obj.explanation || '', level: normLevel(obj.level),
      example: ex?.jp || '', exampleReading: ex?.reading || '', exampleMeaning: ex?.en || '',
      tags: obj.tags || [], order, flagged: flags.length > 0,
      search: conceptSearch('grammar', obj),
    },
    topics: obj.tags || [], flags, loc: `item ${row}`,
    requires: obj.requires || [], contrasts: obj.contrasts || [],
  };
}

/** A grammar point from a table row (mapped columns) -> the same record shape as grammar.json objects. */
export function grammarRowRecord(row, map, order) {
  const v = (role) => (map[role] ? row.values[map[role]] : '');
  const name = v('grammar').replace(/\s+/g, ' ').trim();
  if (!name) return { skip: 'no grammar point', flags: ['missing_name'] };
  const rec = grammarRecord({
    id: `g:${name}`, name, pattern: v('pattern'), explanation: v('explanation') || v('meaning'), level: v('level'),
    examples: v('exampleJp') ? [{ jp: v('exampleJp'), reading: v('exampleReading') || v('exampleRomaji'), en: v('exampleEn') }] : [],
    tags: splitList(v('topic')),
  }, order, row.row);
  return { ...rec, loc: `row ${row.row}`, fromTable: true };
}

export function exerciseRecord(obj, row) {
  const flags = [];
  if (!obj.id || !obj.type || !obj.prompt || obj.answer == null || !obj.concept) return { skip: 'incomplete exercise', flags: ['incomplete'] };
  const format = obj.choices ? 'multiple_choice' : 'typed';
  if (obj.choices && !obj.choices.includes(obj.answer)) flags.push('answer_not_in_choices');
  return {
    id: `ex:${obj.id}`, conceptId: obj.concept,
    props: {
      type: obj.type, format, prompt: obj.prompt, answer: obj.answer,
      choices: obj.choices ? JSON.stringify(obj.choices) : '', accept: JSON.stringify(obj.accept || []),
      alsoValid: JSON.stringify(obj.also_valid || []), checker: format === 'typed' ? 'exact' : '',
      explanation: obj.explanation || '', origin: obj.origin || 'original', flagged: flags.length > 0,
    },
    flags, loc: `line ${row}`,
  };
}
