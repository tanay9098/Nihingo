// Application service: coordinates the three agents through the shared graph.
//   Tutor (read memory, recommend, explain) -> Examiner (select exercises) -> learner answers ->
//   Examiner (evaluate) -> Memory&Planner (write memory, re-plan) -> next Tutor request reads the new state.
import { randomUUID } from 'node:crypto';
import { appMode } from '../config.js';
import { AgentLog } from '../agents/events.js';
import { PlannerAgent } from '../agents/planner.js';
import { ExaminerAgent } from '../agents/examiner.js';
import { TutorAgent } from '../agents/tutor.js';
import { kindOfLabels } from '../graph/catalog.js';

export const LEARNERS = {
  'learner:demo': { name: 'Aiko (demo learner)', isDemo: true },
  'learner:me': { name: 'You', isDemo: false },
};

export class HttpError extends Error {
  constructor(status, message, code = 'bad_request') { super(message); this.status = status; this.code = code; }
}

export class LearningService {
  constructor({ client, catalog, memory, clock = Date.now }) {
    Object.assign(this, { client, catalog, memory, clock });
    this.planner = new PlannerAgent({ memory, catalog, clock });
    this.examiner = new ExaminerAgent({ memory });
    this.tutor = new TutorAgent({ memory, catalog, planner: this.planner });
  }

  async ensureLearners() {
    for (const [id, l] of Object.entries(LEARNERS)) await this.memory.ensureLearner({ id, ...l });
  }

  learnerOr404(id) {
    if (!LEARNERS[id]) throw new HttpError(404, 'Unknown learner profile', 'unknown_learner');
    return id;
  }

  // ---------- session workflow ----------
  async startSession(learnerId, sessionId = randomUUID()) {
    this.learnerOr404(learnerId);
    const existing = await this.memory.getSession(sessionId);
    if (existing) {
      if (existing.learnerId !== learnerId) throw new HttpError(403, 'Session belongs to another profile', 'forbidden');
      return this.sessionView(existing);
    }
    const isDemo = false; // sessions started now are live, even for the demo learner; only seeded history is demo data
    await this.memory.createSession({ id: sessionId, learnerId, startedAt: this.clock(), isDemo, mode: appMode(), status: 'planning', exerciseIds: [] });
    const log = new AgentLog(this.memory, { learnerId, sessionId, isDemo, clock: this.clock });

    const briefing = await this.tutor.brief({ learnerId, log });                       // 1. Tutor retrieves memory
    const prefs = await this.planner.preferences(learnerId);
    const snapshot = await this.planner.gather(learnerId, this.clock());
    const recs = [briefing.recommendation, briefing.listening].filter(Boolean);
    const sel = await this.examiner.selectExercises({ learnerId, recommendations: recs, planner: this.planner, prefs, snapshot }); // 2. Examiner selects
    await this.memory.attachExercises(sessionId, { exerciseIds: sel.picks, focus: briefing.recommendation.focusName, recommendationId: briefing.recommendation.id });
    await log.log('examiner', 'select_exercises', {
      key: sessionId,
      retrieved: { recommendation: briefing.recommendation.id, focus: briefing.recommendation.evidence?.focus, candidateExercises: sel.candidates, preferredFormat: sel.format, formatSource: sel.formatSource, sessionLength: sel.n },
      changed: { selectedEdges: sel.picks.length },
      output: { exercises: sel.picks.map((p) => ({ id: p.id, why: p.reason })) }, handoff: 'exercises_ready',
    });
    return this.sessionView(await this.memory.getSession(sessionId), briefing);
  }

  async sessionView(session, briefing) {
    const ids = await this.memory.sessionExerciseIds(session.id);
    const rows = await this.memory.c.query(
      'MATCH (:LearningSession {id: $sid})-[x:SELECTED]->(e:Exercise) RETURN e.id AS id, x.reason AS reason, x.position AS position ORDER BY position', { sid: session.id },
    );
    const answered = new Set((await this.memory.c.query('MATCH (:LearningSession {id: $sid})-[:INCLUDES]->(a:Attempt) RETURN a.exerciseId AS id', { sid: session.id })).map((r) => r.id));
    const exercises = [];
    for (const r of rows) {
      const ex = await this.memory.getExercise(r.id);
      exercises.push(ExaminerAgent.present(ex, { reason: r.reason, answered: answered.has(r.id) }));
    }
    return { session: { id: session.id, status: session.status, focus: session.focus, total: ids.length }, briefing: briefing ?? null, exercises };
  }

  async answer({ learnerId, sessionId, exerciseId, attemptId = randomUUID(), answer, ms = 0 }) {
    this.learnerOr404(learnerId);
    const session = await this.memory.getSession(sessionId);
    if (!session || session.learnerId !== learnerId) throw new HttpError(404, 'Session not found', 'unknown_session');
    if (session.status === 'completed') throw new HttpError(409, 'Session already completed', 'session_closed');
    const selected = await this.memory.sessionExerciseIds(sessionId);
    if (!selected.includes(exerciseId)) throw new HttpError(400, 'Exercise is not part of this session', 'bad_exercise');

    const prior = await this.memory.getAttempt(attemptId);
    if (prior) return { duplicate: true, result: this.resultFromAttempt(prior) };

    const log = new AgentLog(this.memory, { learnerId, sessionId, isDemo: false, clock: this.clock });
    const { exercise, result } = await this.examiner.evaluate({ exerciseId, answer });        // 4. Examiner evaluates
    await log.log('examiner', 'evaluate_answer', {
      key: attemptId,
      retrieved: { exercise: exercise.id, concept: exercise.conceptIds[0], format: exercise.format, rule: exercise.checker || 'exact-choice' },
      changed: {}, output: { correct: result.correct, ambiguous: result.ambiguous, quality: result.quality }, handoff: 'graded_result',
    });
    const rec = await this.planner.recordAttempt({ learnerId, sessionId, attemptId, exercise, answer, evaluation: result, ms, isDemo: false }); // 5. Planner writes
    if (rec.duplicate) return { duplicate: true, result: this.resultFromAttempt(rec.attempt) };
    await log.log('memory_planner', 'update_memory', {
      key: attemptId,
      retrieved: { gradedResult: { correct: result.correct, quality: result.quality }, previousState: rec.studies.map((s) => ({ concept: s.conceptId, ...s.before })) },
      changed: { created: ['Attempt', ...(rec.mistake ? ['Mistake'] : [])], updated: rec.changes, memoryVersion: rec.version },
      output: {}, handoff: 'memory_updated',
    });
    return {
      duplicate: false,
      result: { ...result, attemptId, concept: exercise.conceptNames[0], conceptId: exercise.conceptIds[0], masteryBefore: rec.attempt.masteryBefore, masteryAfter: rec.attempt.masteryAfter, status: rec.attempt.statusAfter },
    };
  }

  resultFromAttempt(a) {
    return {
      correct: a.correct, ambiguous: a.ambiguous, expected: a.expected, explanation: a.explanation, note: a.feedback, attemptId: a.id,
      conceptId: a.conceptId, masteryBefore: a.masteryBefore, masteryAfter: a.masteryAfter, status: a.statusAfter,
    };
  }

  async complete({ learnerId, sessionId }) {
    this.learnerOr404(learnerId);
    const session = await this.memory.getSession(sessionId);
    if (!session || session.learnerId !== learnerId) throw new HttpError(404, 'Session not found', 'unknown_session');
    const log = new AgentLog(this.memory, { learnerId, sessionId, isDemo: false, clock: this.clock });
    const summary = await this.planner.completeSession({ learnerId, sessionId, log });
    const changes = await this.memory.c.query(
      `MATCH (:LearningSession {id: $sid})-[:INCLUDES]->(a:Attempt)-[:TESTED]->(c:Concept)
       WITH c, a ORDER BY a.at
       RETURN c.id AS id, coalesce(c.name, c.word, c.char) AS name, collect(a.masteryBefore)[0] AS before,
              collect(a.masteryAfter)[-1] AS after, count(a) AS attempts, sum(CASE WHEN a.correct THEN 0 ELSE 1 END) AS mistakes`,
      { sid: sessionId },
    ).catch(() => []);
    return { ...summary, changes, next: await this.tutor.brief({ learnerId }) };
  }

  // ---------- read models ----------
  async dashboard(learnerId) {
    this.learnerOr404(learnerId);
    const learner = await this.memory.getLearner(learnerId);
    const brief = await this.tutor.brief({ learnerId });
    const [sessions, recent, due, studyList, lessons, recurring] = await Promise.all([
      this.memory.recentSessions(learnerId, 6),
      this.memory.recentMistakes(learnerId, 6),
      this.memory.dueItems(learnerId, this.clock(), 8),
      this.memory.studyList(learnerId, 80),
      this.catalog.listLessons(learnerId),
      this.memory.recurringMistakes(learnerId, 1),
    ]);
    const lessonIds = new Set([brief.listening?.focusId].filter(Boolean));
    return {
      mode: appMode(), learner,
      plan: { recommendation: brief.recommendation, explanation: brief.explanation, lesson: brief.lesson },
      listening: brief.listening ? { ...brief.listening, lesson: lessons.find((l) => lessonIds.has(l.id)) ?? null } : null,
      recentSessions: sessions.filter((x) => x.attempts > 0), recentMistakes: recent, progress: brief.progress, due,
      grammarToRevise: recurring.filter((r) => r.kind === 'grammar' && r.mistakes >= 1).slice(0, 5),
      struggling: studyList.filter((s) => s.status === 'struggling').slice(0, 6),
    };
  }

  async memoryView(learnerId) {
    this.learnerOr404(learnerId);
    const [learner, sessions, mistakes, logs, studyList, recurring, recs, prefRows, progress] = await Promise.all([
      this.memory.getLearner(learnerId), this.memory.recentSessions(learnerId, 10), this.memory.recentMistakes(learnerId, 15),
      this.memory.listeningLogs(learnerId, 10), this.memory.studyList(learnerId, 100), this.memory.recurringMistakes(learnerId, 1),
      this.memory.latestRecommendations(learnerId), this.memory.preferences(learnerId), this.memory.progress(learnerId),
    ]);
    const prefs = this.planner ? (await import('../agents/planner.js')).effectivePrefs(prefRows) : {};
    return {
      learner,
      episodic: { sessions, mistakes, listening: logs, note: 'What happened: sessions, answers, mistakes and listening logs.' },
      semantic: { concepts: studyList, recurring, progress, recommendations: recs, note: 'What the learner is estimated to know. Mastery values are conservative estimates, not facts about the language.' },
      procedural: { preferences: prefRows, effective: prefs, note: 'How the learner studies best: explicit settings plus patterns inferred from repeated evidence.' },
    };
  }

  async neighborhood(centerId, { depth = 1, limit = 40, all = false } = {}) {
    const exclude = all ? [] : ['Attempt', 'AgentEvent', 'ListeningLog', 'Mistake', 'LearningSession', 'Exercise', 'Meta', 'Recommendation', 'LearningPreference'];
    const nodes = new Map(); const edges = new Map();
    const labelRows = await this.client.read('MATCH (c {id: $id}) RETURN labels(c) AS labels, coalesce(c.name, c.word, c.char, c.title, c.id) AS name LIMIT 1', { id: centerId });
    if (!labelRows.length) throw new HttpError(404, 'Node not found', 'unknown_node');
    const group = (labels) => kindOfLabels(labels) !== 'concept' ? kindOfLabels(labels) : labels.find((l) => l !== 'Concept') ?? 'node';
    nodes.set(centerId, { id: centerId, label: labelRows[0].name, group: group(labelRows[0].labels), center: true });
    let frontier = [centerId];
    for (let d = 0; d < Math.min(depth, 2); d++) {
      const next = [];
      for (const id of frontier) {
        if (nodes.size >= limit) break;
        const rows = await this.memory.neighborhood(id, { limit: d === 0 ? limit : 8, exclude });
        for (const r of rows) {
          if (!nodes.has(r.id) && nodes.size >= limit) continue;
          if (!nodes.has(r.id)) { nodes.set(r.id, { id: r.id, label: String(r.name).slice(0, 28), group: group(r.labels), status: r.rStatus ?? r.status ?? null, mastery: r.rMastery ?? r.mastery ?? null }); next.push(r.id); }
          const [s, t] = r.outgoing ? [id, r.id] : [r.id, id];
          edges.set(`${s}|${r.rel}|${t}`, { source: s, target: t, type: r.rel, status: r.rStatus ?? null, mastery: r.rMastery ?? null });
        }
      }
      frontier = next;
    }
    return { center: centerId, nodes: [...nodes.values()], edges: [...edges.values()], truncated: nodes.size >= limit, limit };
  }

  async resetLearner(learnerId) {
    this.learnerOr404(learnerId);
    await this.memory.resetLearner(learnerId);
  }
}
