// Agent 2 — Examiner.
// Chooses exercises (from recommendation + learner memory), evaluates answers against explicit rules and
// returns a structured result. It performs NO writes to learner memory: persistence is the Planner's job.
import { gradeAnswer } from './grade.js';
import { PATHWAY } from './pathway.js';

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
    // Several exercises of one concept share a prompt (e.g. a vocabulary word as MC, typed and flashcard), so a session
    // shows each prompt once and spreads its questions over concepts; both are relaxed only if the session can't be filled.
    const usedPrompts = new Set();
    const usedConcepts = new Map();
    let allowSamePrompt = false;
    const promptKey = (e) => String(e.prompt ?? e.id).trim();
    const picks = [];

    const candidatesFor = async (conceptIds) => {
      const rows = await this.memory.exercisesForConcepts(conceptIds);
      const by = {};
      for (const r of rows) (by[r.conceptId] ??= []).push(r);
      return by;
    };
    // Not having seen an exercise recently outweighs an inferred format affinity, but never an explicit format choice.
    const unseen = prefs.formatSource === 'explicit' ? 1.5 : 3;
    const score = (e) => (
      (prefs.format && e.format === prefs.format ? 2 : 0) + (recent.has(e.id) ? 0 : unseen)
      + (usedTypes.get(e.type) ? 0 : 0.5) + (e.format === 'flashcard' && prefs.format !== 'flashcard' ? -1 : 0)
    );
    const pickFor = (list, reason) => {
      const avail = list.filter((e) => !used.has(e.id) && (allowSamePrompt || !usedPrompts.has(promptKey(e))));
      if (!avail.length) return false;
      avail.sort((a, b) => score(b) - score(a) || hashStr(a.id) - hashStr(b.id));
      const e = avail[0];
      used.add(e.id);
      usedPrompts.add(promptKey(e));
      usedConcepts.set(e.conceptId, (usedConcepts.get(e.conceptId) ?? 0) + 1);
      usedTypes.set(e.type, (usedTypes.get(e.type) ?? 0) + 1);
      picks.push({ id: e.id, reason, conceptId: e.conceptId });
      return true;
    };
    // one pass over the concepts, at most one more question each, least-used concepts first
    const roundFor = (ids, cands, reason) => {
      let added = false;
      const order = [...ids].sort((a, b) => (usedConcepts.get(a) ?? 0) - (usedConcepts.get(b) ?? 0));
      for (const id of order) if (picks.length < n && pickFor(cands[id] ?? [], reason)) added = true;
      return added;
    };

    // 1) targeted slots: focus concepts, round-robin
    const targeted = primary.activity === 'new_material' ? 0 : Math.max(2, Math.ceil(n * 0.6));
    const focusCands = await candidatesFor(focusIds);
    const label = { revise_concept: 'Revision of a recurring mistake', revise_prerequisite: 'Revising the basics first', contrast_revision: 'Side-by-side revision of easily confused items', topic_revision: 'Topic revision after a listening gap', review_due: 'Due for review' }[primary.activity] ?? 'Focus';
    let idx = 0, misses = 0;
    while (picks.length < targeted && misses < focusIds.length) {
      const id = focusIds[idx++ % focusIds.length];
      if (pickFor(focusCands[id] ?? [], partnerOf[id] ? `Easy to confuse with “${partnerOf[id]}”` : label)) misses = 0; else misses++;
    }
    // 2) other overdue items
    const dueIds = (snapshot.due || []).map((d) => d.id).filter((id) => !focusIds.includes(id)).slice(0, 3);
    if (dueIds.length && picks.length < n) {
      const dc = await candidatesFor(dueIds);
      for (const id of dueIds) if (picks.length < n - 1) pickFor(dc[id] ?? [], 'Due for review');
    }
    // 3) new material: the next items on the learning path (round-robin in a new-material session, one pass after
    //    revision); with no path items, the planner's next grammar + vocabulary
    const pathIds = (snapshot.pathNext ?? []).map((x) => x.id);
    const stage = snapshot.pathway?.current;
    const newWhy = pathIds.length && stage ? `New material · Step ${stage.step}: ${stage.title}` : 'New material';
    if (pathIds.length && primary.activity === 'new_material') {
      // widen the pool to the next n items of the same step, so n questions don't cycle over the 3 recommended ones
      const step = PATHWAY.find((s) => s.id === stage?.id);
      if (step && step.id !== 'grammar' && step.id !== 'n5') {
        for (const x of await this.memory.nextInStep(learnerId, step, n)) if (!pathIds.includes(x.id)) pathIds.push(x.id);
      }
      const pc = await candidatesFor(pathIds);
      while (picks.length < n && roundFor(pathIds, pc, newWhy)) { /* keep filling */ }
    } else {
      const fresh = (pathIds.length ? pathIds : [...snapshot.nextGrammar.slice(0, 1), ...snapshot.nextVocab.slice(0, 3)].map((x) => x.id))
        .filter((id) => !focusIds.includes(id));
      if (picks.length < n && fresh.length) {
        const fc = await candidatesFor(fresh);
        for (const id of fresh) if (picks.length < n) pickFor(fc[id] ?? [], newWhy);
      }
    }
    // 4) top up from the focus pool (spread over its concepts), then anything; if that still can't fill the session,
    //    allow a prompt that was already shown rather than returning fewer questions
    const topUp = async () => {
      while (picks.length < n && roundFor(focusIds, focusCands, 'More practice')) { /* keep filling */ }
      if (picks.length < n) {
        const nv = await this.memory.nextVocabulary(learnerId, n * 2);
        const nc = await candidatesFor(nv.map((x) => x.id));
        for (const x of nv) if (picks.length < n) pickFor(nc[x.id] ?? [], 'New material');
      }
    };
    await topUp();
    if (picks.length < n) { allowSamePrompt = true; await topUp(); }
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
