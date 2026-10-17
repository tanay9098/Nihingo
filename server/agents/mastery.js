// Conservative mastery estimation + spaced-repetition scheduling. Pure functions, no I/O.
//
// Mastery is the LOWER bound of a Wilson score interval (z = 1.28, ~90% one-sided) over the
// learner's correct/total attempts, so a few lucky answers never look like mastery, and the
// estimate is halved-ish after a fresh miss. It is an *estimate of the learner's knowledge*,
// not a statement about the Japanese language itself.

export const DAY_MS = 86_400_000;
const Z = 1.28;

export function wilsonLower(correct, total, z = Z) {
  if (!total) return 0;
  const p = correct / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return Math.max(0, (centre - margin) / denom);
}

export const EMPTY_STATE = Object.freeze({
  attempts: 0, correct: 0, mistakes: 0, recent: '', intervalDays: 0, ease: 2.3,
  mastery: 0, status: 'new', lastSeen: 0, dueAt: 0,
});

const PACE = { fast: 0.6, normal: 1, slow: 1.5 };

/**
 * @param {object} prev  previous STUDIES edge state (or EMPTY_STATE)
 * @param {{correct:boolean, quality?:number, now:number, pace?:string}} outcome
 *        quality: 0-4 (0 wrong, 1 hard/ambiguous, 2 ok, 3 good, 4 easy)
 */
export function updateStudyState(prev, { correct, quality, now, pace = 'normal' }) {
  const s = { ...EMPTY_STATE, ...prev };
  const q = quality ?? (correct ? 3 : 0);
  const attempts = s.attempts + 1;
  const right = s.correct + (correct ? 1 : 0);
  const recent = (s.recent + (correct ? '1' : '0')).slice(-6);

  let ease = s.ease;
  let intervalDays;
  if (correct) {
    intervalDays = s.intervalDays < 1 ? 1 : Math.round(s.intervalDays * ease * 10) / 10;
    ease = Math.min(2.8, Math.max(1.3, ease + (q >= 4 ? 0.1 : q <= 1 ? -0.05 : 0.02)));
  } else {
    intervalDays = 0; // missed items are due again straight away
    ease = Math.max(1.3, ease - 0.2);
  }
  const mult = PACE[pace] ?? 1;
  const dueAt = correct ? now + Math.round(intervalDays * mult * DAY_MS) : now;

  let mastery = wilsonLower(right, attempts);
  if (!correct) mastery *= 0.6; // a fresh miss counts heavily
  mastery = Math.round(mastery * 1000) / 1000;

  const recentMisses = [...recent].filter((c) => c === '0').length;
  let status = 'learning';
  if (recentMisses >= 2 && recent.slice(-3).includes('0')) status = 'struggling';
  else if (attempts >= 4 && mastery >= 0.6 && recent.endsWith('11')) status = 'mastered';

  return {
    attempts, correct: right, mistakes: s.mistakes + (correct ? 0 : 1), recent,
    intervalDays, ease: Math.round(ease * 100) / 100, mastery, status, lastSeen: now, dueAt,
  };
}

/** Procedural memory: infer the learner's best exercise format from repeated evidence. */
export function inferBestFormat(statsByFormat, { minAttempts = 4, margin = 0.2 } = {}) {
  const ranked = Object.entries(statsByFormat)
    .filter(([, v]) => v.attempts >= minAttempts)
    .map(([format, v]) => ({ format, attempts: v.attempts, accuracy: v.correct / v.attempts }))
    .sort((a, b) => b.accuracy - a.accuracy);
  if (ranked.length < 2) return null;
  if (ranked[0].accuracy - ranked[1].accuracy < margin) return null;
  return ranked[0];
}
