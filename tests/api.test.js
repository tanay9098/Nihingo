import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tryConnect, bootstrap, teardown } from './helpers.js';
import { createApp } from '../server/app.js';
import { config } from '../server/config.js';

const client = await tryConnect();
const skip = client ? false : 'FalkorDB is not reachable (set FALKORDB_HOST/FALKORDB_PORT)';
let server, base, env;
const SECRET = 'sup3r-s3cret-pass';

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
};

test('api: boots, serves the static frontend and consistent JSON envelopes', { skip }, async () => {
  env = await bootstrap(client);
  const cfg = { ...config, falkor: { ...config.falkor, password: SECRET }, llm: { provider: 'openai', apiKey: 'KEY-should-never-leak', model: '' } };
  const app = createApp({ get: async () => env, state: () => ({ ready: true }) }, cfg);
  server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<html lang="en">/); assert.match(html, /type="module"/);
  assert.doesNotMatch(html, /react|vue|angular/i);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  const h = await call('GET', '/api/health');
  assert.equal(h.json.ok, true); assert.equal(h.json.data.falkordb.ok, true); assert.equal(h.json.data.mode, 'demo');
  assert.equal(h.json.data.counts.vocabulary, 56);
});

test('api: no credentials or keys are ever exposed to the browser', { skip }, async () => {
  const paths = ['/api/health', '/api/dashboard', '/api/resources', '/api/learner/memory', '/api/listening', '/api/recommendations', '/api/agents/timeline'];
  for (const p of paths) {
    const r = await call('GET', p);
    assert.equal(r.status, 200, p);
    assert.ok(!r.text.includes(SECRET) && !r.text.includes('KEY-should-never-leak'), `${p} leaked a secret`);
  }
  for (const f of ['index.html', 'js/app.js', 'js/api.js', 'js/dashboard.js', 'js/learning.js', 'js/library.js', 'js/listening.js', 'js/memory.js', 'js/graph.js']) {
    const src = await readFile(`public/${f}`, 'utf8');
    assert.doesNotMatch(src, /FALKORDB|LLM_API_KEY|redis:\/\/|MATCH \(|MERGE \(/, `${f} contains server-only material`);
  }
});

test('api: endpoints return real data; validation errors are consistent', { skip }, async () => {
  assert.equal((await call('GET', '/api/dashboard')).json.data.plan.recommendation.focusId, 'g-ni');
  assert.ok((await call('GET', '/api/library?q=eki')).json.data.items.some((i) => i.word === '駅'));
  assert.equal((await call('GET', '/api/library?kind=bogus')).status, 400);
  assert.equal((await call('GET', '/api/library/item?id=' + encodeURIComponent('v:水'))).json.data.meaning, 'water');
  assert.equal((await call('GET', '/api/library/item?id=nope')).status, 404);
  const res = (await call('GET', '/api/resources')).json.data;
  assert.ok(res.some((r) => r.path === 'original/vocabulary.csv' && r.license));
  const one = await call('GET', '/api/resources/' + encodeURIComponent('res:original/vocabulary.csv'));
  assert.equal(one.json.data.format, 'csv'); assert.ok(one.json.data.linked.length > 50);
  const l = (await call('GET', '/api/listening')).json.data;
  assert.equal(l.lessons.length, 15); assert.equal(l.source.youtube, 'https://www.youtube.com/@LazyBenkyou');
  assert.equal((await call('GET', '/api/nothing')).status, 404);
  assert.equal((await call('GET', '/api/dashboard', null, { 'x-learner-id': 'learner:evil' })).status, 400);
  assert.equal((await call('POST', '/api/attempts', { sessionId: 'x' })).status, 400);
  assert.equal((await call('POST', '/api/attempts', { sessionId: 'x"; DROP', exerciseId: 'y', answer: 'a' })).status, 400);
  assert.equal((await call('POST', '/api/attempts', { sessionId: 'nope', exerciseId: 'ex:gs-ni-1', answer: 'に' })).status, 404);
  assert.equal((await call('POST', '/api/feedback', { type: 'preference', key: 'session_length', value: '99' })).status, 400);
  assert.equal((await call('POST', '/api/feedback', { type: 'nope' })).status, 400);
  assert.equal((await call('POST', '/api/learner/reset', {})).status, 400);
  assert.equal((await call('POST', '/api/listening/lesson:yt:LLbRUBwr74k/log', { rating: 9 })).status, 400);
  assert.equal((await fetch(base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' })).status, 400);
  assert.equal((await call('GET', '/api/graph/neighborhood?center=nope')).status, 404);
});

test('api: injection attempts are inert (queries are parameterised)', { skip }, async () => {
  const q = `x'}) MATCH (n) DETACH DELETE n //`;
  const r = await call('GET', '/api/library?q=' + encodeURIComponent(q));
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/api/health')).json.data.counts.vocabulary, 56);
  const g = await call('POST', '/api/tutor/ask', { question: `"} RETURN 1 //` });
  assert.equal(g.status, 200);
});

test('api: full two-session flow over HTTP', { skip }, async () => {
  const start = await call('POST', '/api/sessions', {});
  assert.equal(start.status, 201);
  const { session, exercises } = start.json.data;
  const before = (await call('GET', '/api/learner/memory')).json.data.semantic.concepts.find((c) => c.id === 'g-ni');
  const ex = exercises.find((e) => e.id.startsWith('ex:gs-ni-'));
  const wrong = ex.choices.find((c) => c !== 'に');
  const body = { sessionId: session.id, exerciseId: ex.id, attemptId: 'http-att-1', answer: wrong };
  const a = await call('POST', '/api/attempts', body);
  assert.equal(a.status, 200); assert.equal(a.json.data.result.correct, false);
  assert.equal((await call('POST', '/api/attempts', body)).json.data.duplicate, true);
  const after = (await call('GET', '/api/learner/memory')).json.data.semantic.concepts.find((c) => c.id === 'g-ni');
  assert.equal(after.attempts, before.attempts + 1);
  assert.ok(after.mastery <= before.mastery);
  // flashcard reveal is only for flashcards of this session
  assert.equal((await call('GET', `/api/sessions/${session.id}/reveal/${encodeURIComponent(ex.id)}`)).status, 403);
  const tl = (await call('GET', `/api/agents/timeline?sessionId=${session.id}`)).json.data;
  assert.deepEqual(tl.map((e) => e.agent).slice(0, 3), ['tutor', 'tutor', 'examiner']);
  const fb = await call('POST', '/api/feedback', { type: 'preference', key: 'revision_pace', value: 'slow' });
  assert.equal(fb.json.data.preferences.effective.revision_pace, 'slow');
  const done = await call('POST', `/api/sessions/${session.id}/complete`, {});
  assert.equal(done.status, 200); assert.ok(done.json.data.next.recommendation.id);
  assert.equal((await call('POST', '/api/attempts', { ...body, attemptId: 'late' })).status, 409);
});

test('api: personal profile starts empty, logs listening and can be reset', { skip }, async () => {
  const me = { 'x-learner-id': 'learner:me' };
  const d = (await call('GET', '/api/dashboard', null, me)).json.data;
  assert.equal(d.recentSessions.length, 0); assert.equal(d.learner.isDemo, false);
  const lessonId = (await call('GET', '/api/listening', null, me)).json.data.lessons[0].id;
  const body = { logId: 'http-ll-1', rating: 4, note: 'got most of it' };
  assert.equal((await call('POST', `/api/listening/${encodeURIComponent(lessonId)}/log`, body, me)).status, 200);
  assert.equal((await call('POST', `/api/listening/${encodeURIComponent(lessonId)}/log`, body, me)).status, 200);
  const l = (await call('GET', '/api/listening', null, me)).json.data;
  assert.equal(l.logs.length, 1); assert.equal(l.logs[0].isDemo, false);
  // the demo learner is unaffected
  assert.equal((await call('GET', '/api/listening')).json.data.logs.every((x) => x.isDemo), true);
  assert.equal((await call('POST', '/api/learner/reset', { confirm: true }, me)).json.data.reseeded, false);
  assert.equal((await call('GET', '/api/listening', null, me)).json.data.logs.length, 0);
});

test('api: degrades cleanly when the database is unavailable', { skip }, async () => {
  const down = createApp({ get: async () => { throw new Error('no db'); }, state: () => ({ ready: false, error: 'Connecting…' }) });
  const s = down.listen(0); const b = `http://127.0.0.1:${s.address().port}`;
  const h = await fetch(b + '/api/health'); assert.equal(h.status, 503);
  const d = await fetch(b + '/api/dashboard'); assert.equal(d.status, 503);
  assert.equal((await d.json()).error.code, 'db_unavailable');
  assert.equal((await fetch(b + '/')).status, 200); // the static app still loads
  s.close();
});

test('teardown', { skip }, async () => { server?.close(); if (client) await teardown(client); });
