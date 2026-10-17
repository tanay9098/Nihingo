// Seeds clearly-labelled DEMO history for the demo learner (Aiko). Everything written here carries
// isDemo = true so the UI can never present it as the current user's real activity.
// The history is produced by the real agents (Examiner grading + Planner memory updates), just with
// explicit historical timestamps — not hand-written graph state.
import { gradeAnswer } from '../agents/grade.js';
import { AgentLog } from '../agents/events.js';
import { DAY_MS } from '../agents/mastery.js';

const DEMO_ID = 'learner:demo';

// [daysAgo, [ [exerciseId, answer], ... ]]  — answers marked ✗ are deliberate mistakes
export const DEMO_HISTORY = [
  [6, [
    ['ex:gs-wo-1', 'を'], ['ex:gs-ni-2', 'で' /* ✗ */], ['ex:gs-de-1', 'で'],
    ['ex:vocab:mc_meaning:v:水', 'water'], ['ex:vocab:mc_meaning:v:駅', 'station'],
  ]],
  [4, [
    ['ex:gs-ni-3', 'で' /* ✗ */], ['ex:gs-de-2', 'に' /* ✗ */], ['ex:gs-wo-2', 'を'],
    ['ex:vocab:mc_reading:v:水', 'みず'], ['ex:vocab:type_reading:v:学校', 'がこう' /* ✗ */],
  ]],
  [2, [
    ['ex:sc-ni-1', 'で' /* ✗ */], ['ex:gs-ni-1', 'に'], ['ex:gs-masu-1', 'ます'],
    ['ex:vocab:type_reading:v:学校', 'がっこう'], ['ex:vocab:recall:v:水', 'water'],
  ]],
];

export async function seedDemo({ service, memory, clock = Date.now, log = () => {} }) {
  const planner = service.planner;
  await memory.resetLearner(DEMO_ID);
  await memory.ensureLearner({ id: DEMO_ID, name: 'Aiko (demo learner)', isDemo: true });
  await memory.upsertPreference({ learnerId: DEMO_ID, key: 'preferred_format', value: 'multiple_choice', source: 'explicit', evidenceCount: 1, evidence: 'Demo data: Aiko said she prefers multiple choice' });

  const now = clock();
  let n = 0;
  for (const [daysAgo, items] of DEMO_HISTORY) {
    n++;
    const start = now - daysAgo * DAY_MS + 9 * 3600_000;
    const sessionId = `demo-session-${n}`;
    await memory.createSession({ id: sessionId, learnerId: DEMO_ID, startedAt: start, isDemo: true, mode: 'demo', status: 'active', exerciseIds: items.map(([id]) => id) });
    const slog = new AgentLog(memory, { learnerId: DEMO_ID, sessionId, isDemo: true, clock: () => start });
    await slog.log('examiner', 'select_exercises', { key: sessionId, retrieved: { note: 'seeded demo session' }, changed: { selectedEdges: items.length }, output: { exercises: items.map(([id]) => id) } });
    let t = start;
    for (const [exId, answer] of items) {
      t += 45_000;
      const exercise = await memory.getExercise(exId);
      if (!exercise) throw new Error(`Demo seed references unknown exercise ${exId}`);
      const g = gradeAnswer(exercise, answer);
      const evaluation = { correct: g.correct, ambiguous: g.ambiguous, quality: g.quality, note: g.note ?? '' };
      const attemptId = `${sessionId}:${exId}`;
      const rec = await planner.recordAttempt({ learnerId: DEMO_ID, sessionId, attemptId, exercise, answer, evaluation, ms: 4000, isDemo: true, explicitNow: t });
      const alog = new AgentLog(memory, { learnerId: DEMO_ID, sessionId, isDemo: true, clock: () => t });
      await alog.log('memory_planner', 'update_memory', { key: attemptId, retrieved: {}, changed: { created: ['Attempt', ...(rec.mistake ? ['Mistake'] : [])], updated: rec.changes }, output: {} });
    }
    await planner.completeSession({ learnerId: DEMO_ID, sessionId, log: null, isDemo: true, endedAt: t + 30_000 });
  }
  // listening history (demo data)
  await memory.logListening({ id: 'demo-listen-1', learnerId: DEMO_ID, lessonId: 'lesson:yt:LLbRUBwr74k', rating: 4, note: 'Demo data: understood most of the shop dialogue.', at: now - 3 * DAY_MS, isDemo: true });
  await memory.setSaved(DEMO_ID, 'lesson:yt:aAZqm-2WKqE', true);
  await memory.bumpMemoryVersion(DEMO_ID);
  const recs = await planner.plan(DEMO_ID, new AgentLog(memory, { learnerId: DEMO_ID, sessionId: 'demo-session-3', isDemo: true, clock }));
  log(`Seeded ${DEMO_HISTORY.length} demo sessions; recommendation: ${recs[0].activity} → ${recs[0].focusName}`);
  return recs;
}
