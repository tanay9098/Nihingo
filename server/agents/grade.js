// Answer-rule engine used by the Examiner. Pure and unit-tested.

const KATA_START = 0x30a1, KATA_END = 0x30f6;

export function toHiragana(s) {
  return [...s].map((ch) => {
    const c = ch.codePointAt(0);
    return c >= KATA_START && c <= KATA_END ? String.fromCodePoint(c - 0x60) : ch;
  }).join('');
}

export function normalize(s) {
  return String(s ?? '').normalize('NFKC').trim().toLowerCase()
    .replace(/[\s。、．，.,!?！？「」'"]+/g, ' ').trim();
}

export function normalizeKana(s) {
  return toHiragana(normalize(s)).replace(/ /g, '');
}

export function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** "to eat; to dine (formal)" -> ['to eat','eat','to dine','dine'] */
export function meaningVariants(meaning) {
  const out = new Set();
  for (const part of String(meaning).split(/[;/]/)) {
    const base = normalize(part.replace(/\([^)]*\)/g, ''));
    if (!base) continue;
    out.add(base);
    out.add(base.replace(/^(to|a|an|the) /, ''));
  }
  return [...out];
}

/**
 * Grade a typed or selected answer.
 * @returns {{correct:boolean, ambiguous:boolean, quality:number, note?:string}}
 */
export function gradeAnswer(exercise, rawAnswer) {
  const given = String(rawAnswer ?? '');
  if (!normalize(given)) return { correct: false, ambiguous: false, quality: 0, note: 'No answer given.' };

  switch (exercise.format) {
    case 'multiple_choice': {
      const ok = given === exercise.answer;
      return { correct: ok, ambiguous: false, quality: ok ? 3 : 0 };
    }
    case 'typed': {
      const kind = exercise.checker || 'exact';
      const accepted = exercise.accept?.length ? exercise.accept : [exercise.answer];
      const also = exercise.alsoValid || [];
      if (kind === 'meaning') {
        const g = normalize(given);
        const variants = accepted.flatMap(meaningVariants);
        if (variants.includes(g)) return { correct: true, ambiguous: false, quality: 3 };
        const close = variants.find((v) => v.length >= 5 && levenshtein(v, g) === 1);
        if (close) return { correct: true, ambiguous: true, quality: 1, note: `Accepted as a near match for "${close}" (possible typo).` };
        return { correct: false, ambiguous: false, quality: 0 };
      }
      if (kind === 'kana') {
        const g = normalizeKana(given);
        const ok = accepted.some((a) => normalizeKana(a) === g || normalize(a) === normalize(given));
        return { correct: ok, ambiguous: false, quality: ok ? 3 : 0 };
      }
      // exact (particles, short answers)
      const g = normalizeKana(given);
      if (accepted.some((a) => normalizeKana(a) === g)) return { correct: true, ambiguous: false, quality: 3 };
      if (also.some((a) => normalizeKana(a) === g)) {
        return { correct: true, ambiguous: true, quality: 2, note: `"${given}" is also valid in this sentence; counted as correct but flagged as ambiguous.` };
      }
      return { correct: false, ambiguous: false, quality: 0 };
    }
    case 'flashcard': {
      const rating = Number(given);
      if (![1, 2, 3, 4].includes(rating)) return { correct: false, ambiguous: false, quality: 0, note: 'Invalid rating.' };
      return { correct: rating >= 2, ambiguous: false, quality: rating === 1 ? 0 : rating === 2 ? 1 : rating === 3 ? 3 : 4 };
    }
    default:
      return { correct: false, ambiguous: false, quality: 0, note: 'Unsupported exercise format.' };
  }
}

/** Format family used for procedural-memory statistics. */
export function formatOf(type) {
  if (type === 'flashcard') return 'flashcard';
  if (type.startsWith('type_') || type === 'sentence_completion' || type === 'recall_meaning') return 'typed';
  return 'multiple_choice';
}
