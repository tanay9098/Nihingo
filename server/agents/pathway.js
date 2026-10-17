// Procedural memory: the recommended beginner sequence through the ingested material.
// Each step is a slice of the existing concept graph (no new nodes or schema). Its order follows the
// resources themselves: kana.json lists hiragana before katakana, vocabulary readings are written in kana,
// the grammar.json examples are built from those words (水を飲みます), kanji on'yomi are written in katakana and
// kanji APPEARS_IN the vocabulary, and the downloaded JLPT N5 files (`resources/local/`) extend all of it.
// Within a step, items keep their source order (`order`); grammar additionally respects REQUIRES.
import { LOCAL_ORDER } from '../ingestion/ingest.js';

// `label` and `where` are static Cypher fragments (never user input); `c` is the concept variable.
export const PATHWAY = [
  {
    id: 'hiragana', module: 'Foundations', title: 'Hiragana', libraryTab: 'kana', libraryTopic: 'hiragana',
    purpose: 'The basic Japanese script. Every word in the course has a hiragana reading, so this comes first.',
    requires: [], label: 'Kana', where: "c.script = 'hiragana'",
  },
  {
    id: 'katakana', module: 'Foundations', title: 'Katakana', libraryTab: 'kana', libraryTopic: 'katakana',
    purpose: 'The second script, used for loanwords (パン) and for kanji on’yomi readings.',
    requires: ['hiragana'], label: 'Kana', where: "c.script = 'katakana'",
  },
  {
    id: 'vocabulary', module: 'Essential vocabulary', title: 'First words', libraryTab: 'vocabulary', libraryTopic: '',
    purpose: 'Everyday words (food, places, verbs, time, people…) with readings and example sentences.',
    requires: ['hiragana', 'katakana'], label: 'Vocabulary', where: `c.order < ${LOCAL_ORDER}`,
  },
  {
    id: 'grammar', module: 'Basic grammar', title: 'Sentence patterns', libraryTab: 'grammar', libraryTopic: '',
    purpose: 'です, ます and the core particles, in prerequisite order, using the words you already know.',
    requires: ['vocabulary'], label: 'GrammarConcept', where: `c.order < ${LOCAL_ORDER}`,
  },
  {
    id: 'kanji', module: 'Writing', title: 'First kanji', libraryTab: 'kanji', libraryTopic: '',
    purpose: 'Common kanji with meanings, readings and stroke counts; most appear in your first words.',
    requires: ['katakana', 'vocabulary'], label: 'Kanji', where: `c.order < ${LOCAL_ORDER}`,
  },
  {
    id: 'n5', module: 'Next steps', title: 'JLPT N5 extension', libraryTab: 'all', libraryTopic: '',
    purpose: 'The downloaded JLPT N5 grammar, vocabulary and kanji lists, after the beginner course.',
    requires: ['grammar', 'kanji'], label: 'Concept', where: `(c:Vocabulary OR c:Kanji OR c:GrammarConcept) AND c.order >= ${LOCAL_ORDER}`,
  },
];

/**
 * Pure: turn per-step counts into the learner's path. A step is `completed` once every item in it has been
 * introduced (has a STUDIES edge); the first step that is not is `current`; later ones are `upcoming`.
 * Steps with no material (e.g. no local files ingested) are dropped.
 */
export function buildPathway(rows) {
  const steps = PATHWAY.map((s) => ({ ...s, ...(rows[s.id] ?? { total: 0, studied: 0, mastered: 0, preview: [] }) }))
    .filter((s) => s.total > 0);
  let current = null;
  const titleOf = Object.fromEntries(steps.map((s) => [s.id, s.title]));
  const out = steps.map((s, i) => {
    let status = 'upcoming';
    if (s.studied >= s.total) status = 'completed';
    else if (!current) { status = 'current'; current = s.id; }
    const { label, where, ...pub } = s;
    return { ...pub, step: i + 1, of: steps.length, status, requires:s.requires.filter((r) => titleOf[r]).map((r) => ({ id: r, title: titleOf[r] })) };
  });
  const cur = out.find((s) => s.id === current) ?? null;
  return { steps: out, current: cur, totalSteps: out.length, completed: out.filter((s) => s.status === 'completed').length };
}

/** Short reference to a step, stored in recommendation evidence. */
export const stageRef = (s) => (s ? { id: s.id, step: s.step, of: s.of, title: s.title, module: s.module } : null);
