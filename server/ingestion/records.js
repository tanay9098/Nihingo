// Turn raw table rows into normalised concept records, flagging anything uncertain.
import { toHiragana } from '../agents/grade.js';

const splitList = (s) => String(s || '').split(/[,;|]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
const HAS_KANJI = /[㐀-鿿]/u;

const searchText = (...parts) => parts.flat().filter(Boolean).map((p) => String(p).normalize('NFKC').toLowerCase()).join(' ');

export function vocabularyRecord(row, map, order) {
  const v = (role) => (map[role] ? row.values[map[role]] : '');
  const word = v('word');
  const flags = [];
  if (!word) return { skip: 'no word', flags: ['missing_word'] };
  const reading = v('reading') || (HAS_KANJI.test(word) ? '' : word);
  if (!reading) flags.push('missing_reading');
  if (!v('meaning')) flags.push('missing_meaning');
  const tags = splitList(v('topic'));
  const level = v('level');
  return {
    id: `v:${word}`,
    props: {
      word, reading, romaji: v('romaji').toLowerCase(), meaning: v('meaning'), pos: v('pos'),
      example: v('exampleJp'), exampleReading: v('exampleReading'), exampleMeaning: v('exampleEn'),
      tags, level: level || 'unknown', hasKanji: HAS_KANJI.test(word), order,
      flagged: flags.length > 0,
      search: searchText(word, reading, toHiragana(reading), v('romaji'), v('meaning'), tags, v('pos'), 'vocabulary'),
    },
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
  return {
    id: `k:${char}`,
    props: {
      char, meaning: v('meaning'), onyomi: v('onyomi'), kunyomi: v('kunyomi'),
      strokes: Number.isFinite(strokes) ? strokes : -1, level: v('level') || 'unknown', order, flagged: flags.length > 0,
      search: searchText(char, v('meaning'), v('onyomi'), v('kunyomi'), toHiragana(v('kunyomi')), 'kanji'),
    },
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
      search: searchText(char, toHiragana(char), v('romaji'), script, 'kana') },
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
      name: obj.name, pattern: obj.pattern || '', explanation: obj.explanation || '', level: obj.level || 'unknown',
      example: ex?.jp || '', exampleReading: ex?.reading || '', exampleMeaning: ex?.en || '',
      tags: obj.tags || [], order, flagged: flags.length > 0,
      search: searchText(obj.name, obj.pattern, obj.explanation, obj.tags, 'grammar'),
    },
    topics: obj.tags || [], flags, loc: `item ${row}`,
    requires: obj.requires || [], contrasts: obj.contrasts || [],
  };
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
