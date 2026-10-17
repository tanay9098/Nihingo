import test from 'node:test';
import assert from 'node:assert/strict';
import { tryConnect, bootstrap, teardown } from './helpers.js';
import { appMode } from '../server/config.js';

const client = await tryConnect();
const skip = client ? false : 'FalkorDB is not reachable (set FALKORDB_HOST/FALKORDB_PORT)';
const L = 'learner:demo';
let env, s1, firstRec;

const wrongAnswer = async (ex) => {
  const full = await env.memory.getExercise(ex.id);
  if (full.choices) return full.choices.find((c) => c !== full.answer);
  return 'zzz';
};
const count = async (q, p = {}) => (await client.query(q, p))[0].n;

test('demo mode works without any LLM key', { skip }, async () => {
  assert.equal(appMode(), 'demo');
  env = await bootstrap(client);
  const d = await env.service.dashboard(L);
  assert.equal(d.mode, 'demo');
  assert.equal(d.plan.explanation.by, 'rules + graph evidence');
});

test('seeded history is flagged as demo and produces a graph-derived recommendation', { skip }, async () => {
  const d = await env.service.dashboard(L);
  firstRec = d.plan.recommendation;
  assert.equal(firstRec.activity, 'revise_concept');
  assert.equal(firstRec.focusId, 'g-ni');
  assert.equal(firstRec.evidence.mistakeCount, 3);
  assert.equal(firstRec.evidence.sessionCount, 3);
  assert.equal(firstRec.evidence.demoMistakes, 3);
  assert.equal(firstRec.evidence.liveMistakes, 0);
  assert.equal(firstRec.isDemoBasis, true);
  assert.ok(d.recentSessions.every((s) => s.isDemo === true));
  assert.ok(d.recentMistakes.every((m) => m.isDemo === true));
  // the evidence points at real Mistake nodes in the graph
  for (const id of firstRec.evidence.mistakeIds) assert.equal(await count('MATCH (m:Mistake {id: $id}) RETURN count(m) AS n', { id }), 1);
  // the learner has not made any real (non-demo) attempts yet
  assert.equal(await count('MATCH (a:Attempt {learnerId: $l}) WHERE a.isDemo = false RETURN count(a) AS n', { l: L }), 0);
  // a fresh profile has no history, so no history-based message may be shown
  const me = await env.service.dashboard('learner:me');
  assert.equal(me.plan.recommendation.rule === undefined ? me.plan.recommendation.evidence.rule : me.plan.recommendation.evidence.rule, 'first-session');
  assert.equal(me.recentSessions.length, 0); assert.equal(me.recentMistakes.length, 0);
  assert.doesNotMatch(me.plan.explanation.text, /incorrectly/);
});

test('session 1: Tutor -> Examiner hand off through the graph; questions target the recommendation', { skip }, async () => {
  s1 = await env.service.startSession(L, 'test-s1');
  const ids = s1.exercises.map((e) => e.id);
  assert.equal(ids.length, 5);
  assert.ok(ids.some((id) => id.startsWith('ex:gs-ni-')), 'targets the struggling concept');
  assert.ok(ids.some((id) => id.includes('gs-de-')), 'includes the CONTRASTS_WITH partner');
  assert.ok(s1.exercises.every((e) => !('answer' in e) && !('accept' in e) && !('explanation' in e)), 'answers are never sent to the browser');
  const ev = await env.memory.events(L, { sessionId: 'test-s1' });
  assert.deepEqual(ev.map((e) => `${e.agent}:${e.action}`), ['tutor:retrieve_memory', 'tutor:recommend_and_explain', 'examiner:select_exercises']);
  assert.ok(ev[1].handoffFrom === ev[0].id && ev[2].handoffFrom === ev[1].id, 'events are chained by HANDED_OFF_TO');
  assert.equal(ev[0].retrieved.conceptsWithMistakes.find((c) => c.id === 'g-ni').mistakes, 3);
  // idempotent start
  const again = await env.service.startSession(L, 'test-s1');
  assert.equal(again.exercises.length, 5);
  assert.equal(await count("MATCH (s:LearningSession {id: 'test-s1'}) RETURN count(s) AS n"), 1);
});

test('attempts are persisted, update memory, and are idempotent', { skip }, async () => {
  const ex = s1.exercises.find((e) => e.id.startsWith('ex:gs-ni-'));
  const beforeMastery = (await env.memory.getStudyStates(L, ['g-ni']))['g-ni'].mastery;
  const beforeVersion = (await env.memory.getLearner(L)).memoryVersion;
  const beforeMistakes = await count("MATCH (m:Mistake {learnerId: 'learner:demo'}) RETURN count(m) AS n");
  const body = { learnerId: L, sessionId: 'test-s1', exerciseId: ex.id, attemptId: 'att-1', answer: await wrongAnswer(ex), ms: 1200 };
  const r1 = await env.service.answer(body);
  assert.equal(r1.result.correct, false);
  assert.ok(r1.result.masteryAfter < beforeMastery || r1.result.masteryAfter === 0);
  assert.equal(await count("MATCH (a:Attempt {id: 'att-1'}) RETURN count(a) AS n"), 1);
  assert.equal(await count("MATCH (:Attempt {id: 'att-1'})-[:RESULTED_IN]->(:Mistake)-[:ABOUT]->(:Concept {id: 'g-ni'}) RETURN count(*) AS n"), 1);
  assert.equal(await count("MATCH (:LearningSession {id: 'test-s1'})-[:INCLUDES]->(:Attempt {id: 'att-1'}) RETURN count(*) AS n"), 1);
  assert.equal(await count("MATCH (m:Mistake {learnerId: 'learner:demo'}) RETURN count(m) AS n"), beforeMistakes + 1);
  assert.equal((await env.memory.getLearner(L)).memoryVersion, beforeVersion + 1);
  assert.equal((await env.memory.getAttempt('att-1')).isDemo, false);

  // replay the same request (network retry / double click): no duplicate records, no double counting
  const r2 = await env.service.answer(body);
  assert.equal(r2.duplicate, true);
  assert.equal(await count("MATCH (a:Attempt {id: 'att-1'}) RETURN count(a) AS n"), 1);
  assert.equal(await count("MATCH (m:Mistake {id: 'mistake:att-1'}) RETURN count(m) AS n"), 1);
  assert.equal((await env.memory.getLearner(L)).memoryVersion, beforeVersion + 1);
  const st = (await env.memory.getStudyStates(L, ['g-ni']))['g-ni'];
  assert.equal(st.attempts, 5); // 4 seeded + 1 live, not 6
  // concurrent identical submissions are serialised per learner
  const ex2 = s1.exercises.find((e) => e.id.includes('gs-de-'));
  const b2 = { learnerId: L, sessionId: 'test-s1', exerciseId: ex2.id, attemptId: 'att-2', answer: await wrongAnswer(ex2) };
  await Promise.all([env.service.answer(b2), env.service.answer(b2), env.service.answer(b2)]);
  assert.equal(await count("MATCH (a:Attempt {id: 'att-2'}) RETURN count(a) AS n"), 1);
});

test('input rules: foreign exercises, other learners and closed sessions are rejected', { skip }, async () => {
  await assert.rejects(env.service.answer({ learnerId: L, sessionId: 'test-s1', exerciseId: 'ex:gs-wa-1', attemptId: 'x', answer: 'は' }), /not part of this session/);
  await assert.rejects(env.service.answer({ learnerId: 'learner:me', sessionId: 'test-s1', exerciseId: 'ex:gs-ni-1', answer: 'に' }), /Session not found/);
  await assert.rejects(env.service.startSession('learner:nobody'), /Unknown learner/);
});

test('completing the session updates memory; the next Tutor request reads the UPDATED state', { skip }, async () => {
  for (const ex of s1.exercises) {
    const answered = await count("MATCH (:LearningSession {id: 'test-s1'})-[:INCLUDES]->(a:Attempt {exerciseId: $e}) RETURN count(a) AS n", { e: ex.id });
    if (answered) continue;
    await env.service.answer({ learnerId: L, sessionId: 'test-s1', exerciseId: ex.id, attemptId: `s1-${ex.id}`, answer: await wrongAnswer(ex) });
  }
  const done = await env.service.complete({ learnerId: L, sessionId: 'test-s1' });
  assert.equal(done.score, 0);
  assert.equal(done.attempts, 5);
  const next = done.next.recommendation;
  assert.notEqual(next.activity, firstRec.activity, 'recommendation changed after the session');
  assert.equal(next.activity, 'contrast_revision');
  assert.deepEqual(next.evidence.focus.map((f) => f.id).sort(), ['g-de', 'g-ni']);
  assert.ok(next.evidence.liveMistakes > 0, 'evidence now includes live answers, not only demo history');
  assert.equal(next.stateVersion, (await env.memory.getLearner(L)).memoryVersion, 'built from the current memory version');
  assert.notEqual(next.id, firstRec.id);
  // only one active study recommendation; the old one is superseded but kept as history
  assert.equal(await count("MATCH (r:Recommendation {learnerId: 'learner:demo', status: 'active', role: 'study'}) RETURN count(r) AS n"), 1);
  assert.equal(await count("MATCH (r:Recommendation {id: $id}) WHERE r.status = 'superseded' RETURN count(r) AS n", { id: firstRec.id }), 1);
  // traceable evidence: BASED_ON edges to Mistake nodes + RECOMMENDS edges to the focus concepts
  assert.ok(await count('MATCH (:Recommendation {id: $id})-[:BASED_ON]->(:Mistake) RETURN count(*) AS n', { id: next.id }) >= 2);
  assert.equal(await count('MATCH (:Recommendation {id: $id})-[:RECOMMENDS]->(:Concept) RETURN count(*) AS n', { id: next.id }), 2);
  // the full agent chain for the session: Tutor -> Examiner -> (Examiner -> Planner)* -> Planner close + plan
  const ev = await env.memory.events(L, { sessionId: 'test-s1', limit: 100 });
  const agents = new Set(ev.map((e) => e.agent));
  assert.deepEqual([...agents].sort(), ['examiner', 'memory_planner', 'tutor']);
  assert.ok(ev.some((e) => e.action === 'update_memory' && e.changed.updated.some((u) => u.includes('STUDIES(g-ni)'))));
  assert.ok(ev.some((e) => e.action === 'close_session'));
  // session 2 uses the new state
  const s2 = await env.service.startSession(L, 'test-s2');
  assert.equal(s2.briefing.recommendation.activity, 'contrast_revision');
  assert.ok(s2.exercises.filter((e) => /gs-(ni|de)-|sc-(ni|de)-/.test(e.id)).length >= 3);
  const ev2 = await env.memory.events(L, { sessionId: 'test-s2' });
  assert.equal(ev2[0].retrieved.storedRecommendation.id, next.id, 'Tutor read the recommendation the Planner wrote');
});

test('procedural memory changes behaviour: explicit preference, inference and removal', { skip }, async () => {
  const planner = env.service.planner;
  await planner.setPreference(L, 'preferred_format', 'typed');
  await planner.setPreference(L, 'session_length', '3');
  const s = await env.service.startSession(L, 'test-s3');
  assert.equal(s.exercises.length, 3);
  assert.equal(s.exercises[0].format, 'typed');
  await assert.rejects(planner.setPreference(L, 'session_length', '99'), /Invalid preference/);
  await planner.clearPreference(L, 'preferred_format');
  const prefs = await planner.preferences(L);
  assert.equal(prefs.preferred_format, 'any');
  // inferred preference came from repeated evidence (>= 4 attempts per format, >= 20 point gap) or is absent
  const inferred = (await env.memory.preferences(L)).find((p) => p.key === 'inferred_format');
  if (inferred) assert.ok(inferred.evidenceCount >= 4 && inferred.source === 'inferred');
});

test('listening: history, notes and ratings persist; low ratings drive recommendations; saves toggle', { skip }, async () => {
  const lessons = await env.catalog.listLessons('learner:me');
  assert.equal(lessons.length, 15);
  assert.ok(lessons.every((l) => l.url.startsWith('https://www.youtube.com/watch?v=') && l.difficulty !== undefined));
  const cafe = lessons.find((l) => l.topics.includes('food'));
  await env.memory.logListening({ id: 'll-1', learnerId: 'learner:me', lessonId: cafe.id, rating: 1, note: 'too fast', at: Date.now() });
  await env.memory.logListening({ id: 'll-1', learnerId: 'learner:me', lessonId: cafe.id, rating: 1, note: 'too fast', at: Date.now() });
  assert.equal(await count("MATCH (g:ListeningLog {id: 'll-1'}) RETURN count(g) AS n"), 1);
  await env.memory.setSaved('learner:me', cafe.id, true); await env.memory.setSaved('learner:me', cafe.id, true);
  assert.equal((await env.catalog.listLessons('learner:me')).find((l) => l.id === cafe.id).saved, true);
  await env.memory.bumpMemoryVersion('learner:me');
  const rec = (await env.service.tutor.brief({ learnerId: 'learner:me' })).recommendation;
  assert.equal(rec.activity, 'topic_revision');
  assert.match(rec.reason, /1\/5/);
  await env.memory.setSaved('learner:me', cafe.id, false);
  assert.equal((await env.catalog.listLessons('learner:me')).find((l) => l.id === cafe.id).saved, false);
});

test('bounded graph neighbourhood, library search and grounded Q&A', { skip }, async () => {
  const g = await env.service.neighborhood(L, { depth: 2, limit: 12 });
  assert.ok(g.nodes.length <= 12);
  assert.ok(g.edges.some((e) => e.type === 'STUDIES' && e.status));
  const s = await env.catalog.search({ q: 'mizu' });          // romaji
  assert.ok(s.items.some((i) => i.word === '水'));
  assert.ok((await env.catalog.search({ q: 'ミズ' })).items.some((i) => i.word === '水'));  // katakana -> hiragana reading
  assert.ok((await env.catalog.search({ q: 'water' })).items.some((i) => i.word === '水'));
  assert.ok((await env.catalog.search({ q: '食' })).items.some((i) => i.kind === 'kanji'));
  assert.ok((await env.catalog.search({ q: 'particle' })).items.some((i) => i.kind === 'grammar'));
  assert.ok((await env.catalog.search({ kind: 'kanji', limit: 5 })).hasMore);
  const a = await env.rag.ask('difference between に and で');
  assert.equal(a.grounded, true); assert.ok(a.passages.some((p) => p.conceptId === 'g-ni'));
  assert.ok(a.passages[0].sources.length > 0);
  const none = await env.rag.ask('quantum chromodynamics');
  assert.equal(none.grounded, false);
});

test('reset: progress deletion and demo re-seeding are repeatable', { skip }, async () => {
  await env.service.resetLearner('learner:me');
  assert.equal(await count("MATCH (n) WHERE n.learnerId = 'learner:me' RETURN count(n) AS n"), 0);
  assert.equal(await count("MATCH (:Learner {id: 'learner:me'})-[:STUDIES]->() RETURN count(*) AS n"), 0);
  const { seedDemo } = await import('../server/seed/demo.js');
  await seedDemo({ service: env.service, memory: env.memory });
  const d = await env.service.dashboard(L);
  assert.equal(d.plan.recommendation.focusId, 'g-ni');
  assert.equal(d.plan.recommendation.evidence.liveMistakes, 0);
  assert.equal(await count("MATCH (s:LearningSession {learnerId: 'learner:demo'}) RETURN count(s) AS n"), 3);
});

test('teardown', { skip }, async () => { if (client) await teardown(client); });
