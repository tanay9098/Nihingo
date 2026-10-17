// Agent 1 — Tutor.
// Reads learner memory + the latest recommendation from the graph, retrieves relevant learning material
// and explains WHY it recommends what it does. It never writes learner memory itself; if the stored
// recommendation is stale it hands off to the Planner.
import { appMode } from '../config.js';
import { askJson, numbersSubset } from '../services/llm.js';

const ACTIVITY_TITLE = {
  revise_concept: 'Targeted revision', revise_prerequisite: 'Prerequisite revision', contrast_revision: 'Compare confusable concepts',
  topic_revision: 'Topic revision', review_due: 'Review what is due', new_material: 'Learn something new', listen: 'Listening practice',
};

export class TutorAgent {
  constructor({ memory, catalog, planner }) { Object.assign(this, { memory, catalog, planner }); }

  async brief({ learnerId, log }) {
    const learner = await this.memory.getLearner(learnerId);
    const t0 = await this.memory.latestRecommendations(learnerId);
    const stored = t0.find((r) => r.role === 'study');
    const stale = !stored || stored.stateVersion !== (learner.memoryVersion ?? 0);

    const [mistakes, prefs, progress] = await Promise.all([
      this.memory.recurringMistakes(learnerId, 1),
      this.planner.preferences(learnerId),
      this.memory.progress(learnerId),
    ]);
    if (log) {
      await log.log('tutor', 'retrieve_memory', {
        key: `v${learner.memoryVersion ?? 0}`,
        retrieved: {
          memoryVersion: learner.memoryVersion ?? 0, conceptsWithMistakes: mistakes.map((m) => ({ id: m.id, mistakes: m.mistakes, sessions: m.sessions, status: m.status })),
          preferences: { format: prefs.format, formatSource: prefs.formatSource, sessionLength: prefs.session_length, includeListening: prefs.include_listening },
          storedRecommendation: stored ? { id: stored.id, stateVersion: stored.stateVersion } : null,
        },
        changed: {}, output: { recommendationStale: stale }, handoff: stale ? 'needs_plan' : 'recommendation',
      });
    }
    let recs = t0;
    if (stale) recs = (await this.planner.plan(learnerId, log)).map((r) => ({ ...r }));
    const primary = recs.find((r) => r.role === 'study');
    const listening = recs.find((r) => r.role === 'listen') ?? null;

    const lesson = await this.lessonFor(primary);
    const explanation = await this.explain(primary, lesson);
    if (log) {
      await log.log('tutor', 'recommend_and_explain', {
        key: `${primary.id}`,
        retrieved: { recommendationId: primary.id, focus: primary.evidence?.focus, materialConcepts: lesson.concepts.map((c) => c.id), sources: lesson.sources.map((s) => s.path) },
        changed: {},
        output: { title: ACTIVITY_TITLE[primary.activity], message: explanation.text, explainedBy: explanation.by, listening: listening?.focusName ?? null },
        handoff: 'exercise_selection',
      });
    }
    return {
      mode: appMode(), stale,
      recommendation: { ...primary, title: ACTIVITY_TITLE[primary.activity] },
      listening: listening ? { ...listening, title: ACTIVITY_TITLE.listen } : null,
      explanation, lesson, progress, memory: { mistakes, prefs },
    };
  }

  /** Gather the source material (concept cards + resources) that backs the recommendation. */
  async lessonFor(rec) {
    const ids = (rec.evidence?.focus ?? []).map((f) => f.id).slice(0, 3);
    const concepts = [];
    const sources = new Map();
    for (const id of ids) {
      const c = await this.catalog.getConcept(id);
      if (!c) continue;
      concepts.push({
        id: c.id, kind: c.kind, name: c.name || c.word || c.char, pattern: c.pattern, explanation: c.explanation, meaning: c.meaning,
        reading: c.reading, romaji: c.romaji, script: c.script, example: c.example, exampleReading: c.exampleReading, exampleMeaning: c.exampleMeaning,
        related: c.related.filter((r) => r.rel !== 'APPEARS_IN').slice(0, 5),
      });
      for (const r of c.resources) sources.set(r.id, { title: r.title, path: r.path, source: r.source, license: r.license });
    }
    return { concepts, sources: [...sources.values()] };
  }

  async explain(rec, lesson) {
    const deterministic = { text: rec.reason, by: 'rules + graph evidence' };
    if (appMode() !== 'ai') return deterministic;
    const evidence = JSON.stringify({ reason: rec.reason, evidence: rec.evidence, material: lesson.concepts.map((c) => ({ name: c.name, explanation: c.explanation, example: c.example, meaning: c.meaning })) });
    const r = await askJson({
      system: 'You are a friendly Japanese tutor. Rewrite the recommendation reason in 2 short sentences for a beginner, using ONLY facts present in the JSON. Do not add numbers. JSON: {"message": string}',
      user: evidence,
      validate: (o) => {
        if (typeof o.message !== 'string' || o.message.length < 10 || o.message.length > 500) throw new Error('invalid message');
        if (!numbersSubset(o.message, evidence)) throw new Error('message contains unsupported figures');
        return o.message.trim();
      },
    });
    return r.ok ? { text: r.value, by: 'LLM, grounded in graph evidence', original: rec.reason } : { ...deterministic, llmFallback: r.reason };
  }
}
