// Agent 2 — Examiner.
// Chooses exercises (from recommendation + learner memory), evaluates answers against explicit rules and
// returns a structured result. It performs NO writes to learner memory: persistence is the Planner's job.
import { gradeAnswer } from './grade.js';

const hashStr = (str) => { let x = 2166136261; for (const ch of str) { x ^= ch.codePointAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };

const FORMAT_LABEL = { multiple_choice: 'multiple choice', typed: 'typed answer', flashcard: 'flashcard' };

export class ExaminerAgent {
  constructor({ memory }) { this.memory = memory; }

  /** Public (answer-free) view of an exercise. */
  static present(ex, extra = {}) {
    return {
      id: ex.id, type: ex.type, format: ex.format, prompt: ex.prompt, choices: ex.choices ?? null, origin: ex.origin,
      conceptId: ex.conceptIds?.[0], conceptName: ex.conceptNames?.[0], ...extra,
      // flashcards reveal the reading/meaning only after the learner flips the card
      hasReveal: ex.format === 'flashcard',
    };
  }

  async selectExercises({ learnerId, recommendations, planner, prefs, snapshot }) {
    const n = prefs.session_length;
    const primary = recommendations.find((r) => r.role === 'study');
    let focusIds = primary.evidence.focus.map((f) => f.id);
    const partnerOf = {};
    if (primary.activity === 'revise_concept') {
      // Graph-derived design choice: revise a concept alongside the concept it is commonly confused with.
      for (const p of await this.memory.contrastPartners(focusIds[0])) { partnerOf[p.id] = primary.evidence.focus[0].name; focusIds.push(p.id); }
    }
    const recent = new Set(await this.memory.recentExerciseIds(learnerId, 30));
    const used = new Set();
    const usedTypes = new Map();
    const picks = [];

    const candidatesFor = async (conceptIds) => {
      const rows = await this.memory.exercisesForConcepts(conceptIds);
      const by = {};
      for (const r of rows) (by[r.conceptId] ??= []).push(r);
      return by;
    };
    const score = (e) => (
      (prefs.format && e.format === prefs.format ? 2 : 0) + (recent.has(e.id) ? 0 : 1)
      + (usedTypes.get(e.type) ? 0 : 0.5) + (e.format === 'flashcard' && prefs.format !== 'flashcard' ? -1 : 0)
    );
    const pickFor = (list, reason) => {
      const avail = list.filter((e) => !used.has(e.id));
      if (!avail.length) return false;
      avail.sort((a, b) => score(b) - score(a) || hashStr(a.id) - hashStr(b.id));
      const e = avail[0];
      used.add(e.id);
      usedTypes.set(e.type, (usedTypes.get(e.type) ?? 0) + 1);
      picks.push({ id: e.id, reason, conceptId: e.conceptId });
      return true;
    };

    // 1) targeted slots: focus concepts, round-robin
    const targeted = primary.activity === 'new_material' ? 0 : Math.max(2, Math.ceil(n * 0.6));
    const focusCands = await candidatesFor(focusIds);
    const label = { revise_concept: 'Revision of a recurring mistake', revise_prerequisite: 'Prerequisite revision', contrast_revision: 'Side-by-side revision of confusable concepts', topic_revision: 'Topic revision after a listening gap', review_due: 'Due for review' }[primary.activity] ?? 'Focus';
    let idx = 0, misses = 0;
    while (picks.length < targeted && misses < focusIds.length) {
      const id = focusIds[idx++ % focusIds.length];
      if (pickFor(focusCands[id] ?? [], partnerOf[id] ? `Confusable with “${partnerOf[id]}” (CONTRASTS_WITH)` : label)) misses = 0; else misses++;
    }
    // 2) other overdue items
    const dueIds = (snapshot.due || []).map((d) => d.id).filter((id) => !focusIds.includes(id)).slice(0, 3);
    if (dueIds.length && picks.length < n) {
      const dc = await candidatesFor(dueIds);
      for (const id of dueIds) if (picks.length < n - 1) pickFor(dc[id] ?? [], 'Due for review');
    }
    // 3) new material (planner's next grammar + vocabulary)
    const fresh = [...snapshot.nextGrammar.slice(0, 1), ...snapshot.nextVocab.slice(0, 3)].map((x) => x.id).filter((id) => !focusIds.includes(id));
    if (picks.length < n && fresh.length) {
      const fc = await candidatesFor(fresh);
      for (const id of fresh) if (picks.length < n) pickFor(fc[id] ?? [], 'New material');
    }
    // 4) top up from the focus pool, then anything
    if (picks.length < n) {
      for (const id of focusIds) while (picks.length < n && pickFor(focusCands[id] ?? [], 'More practice')) { /* keep filling */ }
    }
    if (picks.length < n) {
      const nv = await this.memory.nextVocabulary(learnerId, n * 2);
      const nc = await candidatesFor(nv.map((x) => x.id));
      for (const x of nv) if (picks.length < n) pickFor(nc[x.id] ?? [], 'New material');
    }
    return { picks: picks.slice(0, n), format: prefs.format, formatSource: prefs.formatSource, n, candidates: Object.values(focusCands).flat().length };
  }

  /** Grade an answer. Returns a structured, explainable result. */
  async evaluate({ exerciseId, answer }) {
    const ex = await this.memory.getExercise(exerciseId);
    if (!ex) { const e = new Error('Unknown exercise'); e.status = 404; throw e; }
    const g = gradeAnswer(ex, answer);
    return {
      exercise: ex,
      result: {
        correct: g.correct, ambiguous: g.ambiguous, quality: g.quality, note: g.note ?? '',
        expected: ex.format === 'flashcard' ? `${ex.answer}${ex.explanation ? ` — ${ex.explanation}` : ''}` : ex.answer,
        explanation: ex.explanation ?? '', format: ex.format, formatLabel: FORMAT_LABEL[ex.format] ?? ex.format,
      },
    };
  }
}
