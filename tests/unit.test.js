import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeAnswer, normalizeKana, levenshtein, meaningVariants } from '../server/agents/grade.js';
import { updateStudyState, wilsonLower, EMPTY_STATE, inferBestFormat, DAY_MS } from '../server/agents/mastery.js';
import { parseDelimited, parseTable } from '../server/ingestion/csv.js';
import { classifyTable } from '../server/ingestion/mapping.js';
import { decide } from '../server/agents/planner.js';
import { vocabularyExercises } from '../server/ingestion/exercises.js';
import { parseFeed } from '../scripts/refresh-listening-catalog.js';
import { appMode } from '../server/config.js';
import { readFile } from 'node:fs/promises';

test('grading: multiple choice is exact', () => {
  assert.equal(gradeAnswer({ format: 'multiple_choice', answer: 'に' }, 'に').correct, true);
  assert.equal(gradeAnswer({ format: 'multiple_choice', answer: 'に' }, 'で').correct, false);
  assert.equal(gradeAnswer({ format: 'multiple_choice', answer: 'に' }, '').correct, false);
});

test('grading: typed kana accepts katakana/hiragana and romaji, rejects wrong', () => {
  const ex = { format: 'typed', checker: 'kana', answer: 'みず', accept: ['みず', 'mizu'] };
  assert.equal(gradeAnswer(ex, 'ミズ').correct, true);
  assert.equal(gradeAnswer(ex, ' MIZU ').correct, true);
  assert.equal(gradeAnswer(ex, 'みづ').correct, false);
});

test('grading: ambiguous answers are accepted but flagged', () => {
  const ex = { format: 'typed', checker: 'exact', answer: 'に', accept: ['に'], alsoValid: ['へ'] };
  const r = gradeAnswer(ex, 'へ');
  assert.equal(r.correct, true); assert.equal(r.ambiguous, true);
  assert.equal(gradeAnswer(ex, 'に').ambiguous, false);
});

test('grading: meaning recall handles variants and near-miss typos', () => {
  const ex = { format: 'typed', checker: 'meaning', answer: 'to eat; to dine (formal)', accept: ['to eat; to dine (formal)'] };
  assert.equal(gradeAnswer(ex, 'eat').correct, true);
  assert.equal(gradeAnswer(ex, 'To Eat').ambiguous, false);
  const typo = gradeAnswer({ format: 'typed', checker: 'meaning', answer: 'hospital', accept: ['hospital'] }, 'hospitel');
  assert.equal(typo.correct, true); assert.equal(typo.ambiguous, true);
  assert.equal(gradeAnswer(ex, 'drink').correct, false);
  assert.deepEqual(meaningVariants('to eat'), ['to eat', 'eat']);
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(normalizeKana('カタカナ'), 'かたかな');
});

test('grading: flashcard ratings', () => {
  const ex = { format: 'flashcard' };
  assert.equal(gradeAnswer(ex, '1').correct, false);
  assert.equal(gradeAnswer(ex, '3').correct, true);
  assert.equal(gradeAnswer(ex, '9').correct, false);
});

test('mastery is conservative: few lucky answers are not mastery; a miss hurts', () => {
  assert.ok(wilsonLower(1, 1) < 0.5);
  assert.ok(wilsonLower(4, 4) > 0.6);
  let s = EMPTY_STATE;
  for (let i = 0; i < 3; i++) s = updateStudyState(s, { correct: true, now: 0 });
  assert.notEqual(s.status, 'mastered'); // needs >= 4 attempts
  s = updateStudyState(s, { correct: true, now: 0 });
  assert.equal(s.status, 'mastered');
  const m = s.mastery;
  s = updateStudyState(s, { correct: false, now: 1000 });
  assert.ok(s.mastery < m * 0.7);
  assert.equal(s.dueAt, 1000); // missed items are due immediately
  assert.equal(s.mistakes, 1);
});

test('spaced repetition: interval grows on success; pace scales it', () => {
  const t = updateStudyState(EMPTY_STATE, { correct: true, now: 0, pace: 'slow' });
  assert.equal(t.dueAt, 1.5 * DAY_MS);
  const f = updateStudyState(EMPTY_STATE, { correct: true, now: 0, pace: 'fast' });
  assert.equal(f.dueAt, 0.6 * DAY_MS);
  const t2 = updateStudyState(updateStudyState(EMPTY_STATE, { correct: true, now: 0 }), { correct: true, now: 0 });
  assert.ok(t2.intervalDays > 1);
});

test('struggling status needs repeated recent misses', () => {
  let s = updateStudyState(EMPTY_STATE, { correct: false, now: 0 });
  assert.equal(s.status, 'learning');
  s = updateStudyState(s, { correct: false, now: 0 });
  assert.equal(s.status, 'struggling');
});

test('procedural inference needs evidence and a clear margin', () => {
  assert.equal(inferBestFormat({ typed: { attempts: 10, correct: 5 } }), null);
  assert.equal(inferBestFormat({ typed: { attempts: 10, correct: 5 }, multiple_choice: { attempts: 10, correct: 6 } }), null);
  assert.equal(inferBestFormat({ typed: { attempts: 2, correct: 0 }, multiple_choice: { attempts: 10, correct: 9 } }), null);
  assert.equal(inferBestFormat({ typed: { attempts: 10, correct: 4 }, multiple_choice: { attempts: 10, correct: 8 } }).format, 'multiple_choice');
});

test('CSV parser: quotes, embedded commas/newlines, BOM, TSV', () => {
  assert.deepEqual(parseDelimited('﻿a,b\n"x, y","he said ""hi"""\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
  assert.deepEqual(parseDelimited('a\tb\n1\t2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseDelimited('a,b\n"line1\nline2",2\n')[1], ['line1\nline2', '2']);
  assert.throws(() => parseDelimited('a,b\n"oops,1\n'));
});

test('column inspection classifies real files by headers AND values', async () => {
  const vocab = parseTable(await readFile('resources/original/vocabulary.csv', 'utf8'));
  assert.equal(classifyTable(vocab.headers, vocab.records).kind, 'vocabulary');
  const kanji = parseTable(await readFile('resources/original/kanji.csv', 'utf8'));
  assert.equal(classifyTable(kanji.headers, kanji.records).kind, 'kanji');
  // a "kanji" column holding multi-character words is vocabulary, not a kanji table
  const t = parseTable('kanji,reading,meaning\n学校,がっこう,school\n先生,せんせい,teacher\n');
  assert.equal(classifyTable(t.headers, t.records).kind, 'vocabulary');
  const junk = parseTable('foo,bar\n1,2\n');
  assert.equal(classifyTable(junk.headers, junk.records).kind, 'unrecognized');
});

test('exercise generation is deterministic (idempotent re-ingestion)', () => {
  const v = (word, meaning) => ({ id: `v:${word}`, props: { word, reading: word, romaji: word, meaning, pos: 'noun', hasKanji: false } });
  const list = ['a', 'b', 'c', 'd', 'e', 'f'].map((w, i) => v(w, `m${i}`));
  assert.deepEqual(vocabularyExercises(list), vocabularyExercises(list));
  const mc = vocabularyExercises(list).find((e) => e.props.type === 'vocab_mc_meaning');
  const choices = JSON.parse(mc.props.choices);
  assert.equal(choices.length, 4); assert.ok(choices.includes(mc.props.answer));
  assert.equal(new Set(choices).size, 4);
});

const base = { recurring: [], prereqs: {}, contrasts: {}, due: [], nextGrammar: [], nextVocab: [], lowListening: [], noHistory: false };
const rec = (o) => ({ kind: 'grammar', sessions: 2, lastAt: 1, mistakeIds: ['m1'], status: 'struggling', recent: '001', mastery: 0.1, ...o });

test('planner policy: no history -> first session; nothing urgent -> new material', () => {
  assert.equal(decide({ ...base, noHistory: true, nextGrammar: [{ id: 'g1', name: 'G' }] }).rule, 'first-session');
  assert.equal(decide({ ...base, nextGrammar: [{ id: 'g1', name: 'G' }] }).activity, 'new_material');
});

test('planner policy: recurring mistakes, prerequisite gaps, confusable pairs', () => {
  const a = rec({ id: 'a', name: 'A', mistakes: 3 });
  assert.equal(decide({ ...base, recurring: [a] }).activity, 'revise_concept');
  assert.equal(decide({ ...base, recurring: [rec({ id: 'a', name: 'A', mistakes: 1 })] }).activity, 'new_material'); // one slip is not "recurring"
  const gap = decide({ ...base, recurring: [a], prereqs: { a: [{ id: 'p', name: 'P', attempts: 0 }] } });
  assert.equal(gap.activity, 'revise_prerequisite'); assert.equal(gap.focus[0].id, 'p');
  const b = rec({ id: 'b', name: 'B', mistakes: 2 });
  const pair = decide({ ...base, recurring: [a, b], contrasts: { a: [{ id: 'b' }] } });
  assert.equal(pair.activity, 'contrast_revision'); assert.equal(pair.focus.length, 2);
  // recovered concepts (two latest answers right) stop being recommended
  assert.equal(decide({ ...base, recurring: [rec({ id: 'a', name: 'A', mistakes: 4, recent: '0011' })] }).activity, 'new_material');
  // overdue review beats new material
  assert.equal(decide({ ...base, due: [{ id: 'x', name: 'X' }] }).activity, 'review_due');
});

test('Lazy Benkyou catalog: verified structure, never fabricated levels or transcripts', async () => {
  const cat = JSON.parse(await readFile('resources/external/lazybenkyou_videos.json', 'utf8'));
  assert.equal(cat.source.youtubeChannel, 'https://www.youtube.com/@LazyBenkyou');
  assert.ok(cat.videos.length >= 10);
  for (const v of cat.videos) {
    assert.match(v.videoId, /^[A-Za-z0-9_-]{11}$/);
    assert.equal(v.url, `https://www.youtube.com/watch?v=${v.videoId}`);
    assert.equal(v.embedUrl, `https://www.youtube-nocookie.com/embed/${v.videoId}`);
    assert.equal(v.transcript, null);
    // a level is only ever recorded when the title itself states it
    assert.equal(v.difficulty !== 'unknown', /JLPT\s*N[1-5]/i.test(v.title));
  }
  assert.equal(new Set(cat.videos.map((v) => v.videoId)).size, cat.videos.length);
});

test('feed parser: levels only from titles; unknown otherwise', () => {
  const xml = `<feed><entry><yt:videoId>aaaaaaaaaaa</yt:videoId><title>Cafe talk | JLPT N5</title><published>2026-01-02T00:00:00+00:00</published></entry>
  <entry><yt:videoId>bbbbbbbbbbb</yt:videoId><title>Random chat &amp; fun</title><published>2026-01-03T00:00:00+00:00</published></entry></feed>`;
  const [a, b] = parseFeed(xml);
  assert.equal(a.difficulty, 'N5'); assert.equal(b.difficulty, 'unknown'); assert.equal(b.title, 'Random chat & fun');
});

test('mode is demo unless provider, key and model are all set', () => {
  assert.equal(appMode({ llm: { provider: '', apiKey: '', model: '' } }), 'demo');
  assert.equal(appMode({ llm: { provider: 'openai', apiKey: 'k', model: '' } }), 'demo');
  assert.equal(appMode({ llm: { provider: 'openai', apiKey: 'k', model: 'm' } }), 'ai');
});
