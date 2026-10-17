// Deterministic exercise generation from structured concept records.
// "generated-from-source" = built mechanically from a resource row (answers come straight from the data).
// Distractors are chosen by a stable hash, so re-ingestion produces identical exercises (idempotent).

function hash(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function pickDistractors(seed, pool, answer, n = 3) {
  const uniq = [...new Set(pool)].filter((x) => x && x !== answer);
  return uniq.map((x) => [hash(seed + '|' + x), x]).sort((a, b) => a[0] - b[0]).slice(0, n).map(([, x]) => x);
}

function shuffle(seed, arr) {
  return arr.map((x) => [hash(seed + '#' + x), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
}

const mc = (id, type, conceptId, prompt, answer, distractorPool, extra = {}) => {
  const choices = shuffle(id, [answer, ...pickDistractors(id, distractorPool, answer)]);
  return {
    id, conceptId,
    props: {
      type, format: 'multiple_choice', prompt, answer, choices: JSON.stringify(choices), accept: '[]', alsoValid: '[]',
      checker: '', origin: 'generated-from-source', ...extra,
    },
  };
};

const typed = (id, type, conceptId, prompt, answer, accept, checker, extra = {}) => ({
  id, conceptId,
  props: { type, format: 'typed', prompt, answer, choices: '', accept: JSON.stringify(accept), alsoValid: '[]', checker, origin: 'generated-from-source', ...extra },
});

export function vocabularyExercises(vocab) {
  const out = [];
  const firstMeaning = (m) => m.split(';')[0].trim();
  for (const v of vocab) {
    const p = v.props;
    if (!p.meaning) continue;
    const same = vocab.filter((o) => o.id !== v.id && o.props.meaning);
    const samePos = same.filter((o) => o.props.pos === p.pos);
    const pool = (samePos.length >= 6 ? samePos : same);
    out.push(mc(`ex:vocab:mc_meaning:${v.id}`, 'vocab_mc_meaning', v.id, `${p.word}`, p.meaning, pool.map((o) => o.props.meaning),
      { explanation: `${p.word}${p.reading && p.reading !== p.word ? `（${p.reading}）` : ''} means "${p.meaning}".` }));
    out.push(mc(`ex:vocab:en_to_jp:${v.id}`, 'vocab_en_to_jp', v.id, firstMeaning(p.meaning), p.word, pool.map((o) => o.props.word),
      { explanation: `"${firstMeaning(p.meaning)}" is ${p.word}${p.reading && p.reading !== p.word ? `（${p.reading}）` : ''}.` }));
    out.push(typed(`ex:vocab:recall:${v.id}`, 'recall_meaning', v.id, `${p.word}`, p.meaning, [p.meaning], 'meaning',
      { explanation: `${p.word} means "${p.meaning}".` }));
    out.push({ id: `ex:vocab:flash:${v.id}`, conceptId: v.id, props: {
      type: 'flashcard', format: 'flashcard', prompt: p.word, answer: p.reading || p.word, choices: '', accept: '[]', alsoValid: '[]', checker: '',
      origin: 'generated-from-source', explanation: `${p.word}（${p.reading}）= ${p.meaning}`,
    } });
    if (p.hasKanji && p.reading) {
      const readings = pool.filter((o) => o.props.reading).map((o) => o.props.reading);
      out.push(mc(`ex:vocab:mc_reading:${v.id}`, 'vocab_mc_reading', v.id, `${p.word}`, p.reading, readings,
        { explanation: `${p.word} is read ${p.reading}.` }));
      out.push(typed(`ex:vocab:type_reading:${v.id}`, 'type_reading', v.id, `${p.word}`, p.reading,
        [p.reading, p.romaji].filter(Boolean), 'kana', { explanation: `${p.word} is read ${p.reading} (${p.romaji}).` }));
    }
  }
  return out;
}

export function kanaExercises(kana) {
  const out = [];
  for (const k of kana) {
    const p = k.props;
    const sameScript = kana.filter((o) => o.id !== k.id && o.props.script === p.script);
    out.push(mc(`ex:kana:mc_romaji:${k.id}`, 'kana_mc_romaji', k.id, p.char, p.romaji, sameScript.map((o) => o.props.romaji),
      { explanation: `${p.char} is "${p.romaji}" (${p.script}).` }));
    out.push(mc(`ex:kana:mc_char:${k.id}`, 'kana_mc_char', k.id, `${p.romaji} (${p.script})`, p.char, sameScript.map((o) => o.props.char),
      { explanation: `"${p.romaji}" in ${p.script} is ${p.char}.` }));
  }
  return out;
}

export function kanjiExercises(kanji) {
  const out = [];
  for (const k of kanji) {
    const p = k.props;
    if (p.meaning) {
      out.push(mc(`ex:kanji:mc_meaning:${k.id}`, 'kanji_mc_meaning', k.id, p.char, p.meaning,
        kanji.filter((o) => o.id !== k.id).map((o) => o.props.meaning), { explanation: `${p.char} means "${p.meaning}".` }));
    }
    if (p.strokes > 0) {
      const nums = kanji.filter((o) => o.id !== k.id && o.props.strokes > 0).map((o) => String(o.props.strokes));
      out.push(mc(`ex:kanji:mc_strokes:${k.id}`, 'kanji_mc_strokes', k.id, `${p.char} — how many strokes?`, String(p.strokes), nums,
        { explanation: `${p.char} is written with ${p.strokes} strokes (stroke count from the source data; stroke ORDER is not included).` }));
    }
  }
  return out;
}

// The Japanese part of a grammar point's name: "A が いちばん～ (A ga ichiban～)" -> "がいちばん".
const grammarCore = (name) => name.replace(/\(.*?\)/g, '').replace(/[A-Za-z0-9～~〜。、.,\s+…]/g, '');

export function grammarExercises(grammar) {
  const out = [];
  for (const g of grammar) {
    const p = g.props;
    const others = grammar.filter((o) => o.id !== g.id);
    if (p.explanation) {
      out.push(mc(`ex:grammar:mc_meaning:${g.id}`, 'grammar_mc_meaning', g.id, p.name, p.explanation, others.map((o) => o.props.explanation).filter(Boolean),
        { explanation: `${p.name}: ${p.explanation}${p.pattern ? ` Pattern: ${p.pattern}` : ''}` }));
    }
    if (p.example) {
      // a distractor whose Japanese also occurs in the sentence could be a second right answer, so leave those out
      const pool = others.filter((o) => { const c = grammarCore(o.props.name); return !c || !p.example.includes(c); }).map((o) => o.props.name);
      out.push(mc(`ex:grammar:mc_point:${g.id}`, 'grammar_mc_point', g.id, `Which grammar point does this sentence use?\n${p.example}${p.exampleMeaning ? `\n(${p.exampleMeaning})` : ''}`,
        p.name, pool, { explanation: `${p.example} uses ${p.name}${p.explanation ? ` — ${p.explanation}` : ''}` }));
    }
    if (p.pattern || p.explanation) {
      out.push({ id: `ex:grammar:flash:${g.id}`, conceptId: g.id, props: {
        type: 'flashcard', format: 'flashcard', prompt: p.name, answer: p.pattern || p.explanation, choices: '', accept: '[]', alsoValid: '[]', checker: '',
        origin: 'generated-from-source', explanation: [p.explanation, p.pattern && `Pattern: ${p.pattern}`, p.example && `e.g. ${p.example}`].filter(Boolean).join(' · '),
      } });
    }
  }
  return out;
}
