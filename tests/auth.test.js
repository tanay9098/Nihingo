// Sign in with Google (Google's token endpoint replaced by a fake), guest accounts, and email + password turned off by default.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tryConnect, bootstrap, teardown } from './helpers.js';
import { createApp } from '../server/app.js';
import { config } from '../server/config.js';
import { GoogleAuth } from '../server/services/google.js';
import { AuthService } from '../server/services/auth.js';

const client = await tryConnect();
const skip = client ? false : 'FalkorDB is not reachable (set FALKORDB_HOST/FALKORDB_PORT)';
let server, base, env;

// What the fake Google token endpoint says about the person signing in.
let person = null;
const fakeFetch = async (url, opts) => {
  const nonce = pending.get(new URLSearchParams(opts.body).get('code'));
  const claims = { iss: 'https://accounts.google.com', aud: 'test-client', exp: Math.floor(Date.now() / 1000) + 300, nonce, email_verified: true, ...person };
  return { ok: true, json: async () => ({ id_token: `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s` }) };
};
const pending = new Map(); // authorization code -> nonce of the flow it belongs to

const cookiesOf = (res) => Object.fromEntries((res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0].split(/=(.*)/s).slice(0, 2)));
const call = async (method, path, body, headers = {}) => {
  const res = await fetch(base + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, location: res.headers.get('location'), cookies: cookiesOf(res) };
};
const jar = (cookies) => ({ cookie: Object.entries(cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ') });

/** Runs the whole redirect flow as `who`, optionally while already signed in (e.g. as a guest). Returns the callback response. */
async function googleSignIn(who, session = '') {
  person = who;
  const start = await call('GET', '/api/auth/google/start', null, session ? jar({ nh_session: session }) : {});
  assert.equal(start.status, 303);
  const q = new URL(start.location).searchParams;
  const code = `code-${Math.random()}`;
  pending.set(code, q.get('nonce'));
  return call('GET', `/api/auth/google/callback?code=${code}&state=${q.get('state')}`, null, jar({ nh_oauth: start.cookies.nh_oauth, nh_session: session }));
}

test('auth: boot with Google configured', { skip }, async () => {
  env = await bootstrap(client, { seed: false });
  env.google = new GoogleAuth({ clientId: 'test-client', clientSecret: 'test-secret', fetch: fakeFetch });
  const cfg = { ...config, auth: { ...config.auth, passwordAuth: false }, google: { ...config.google, redirectUri: '' } };
  server = createApp({ get: async () => env, state: () => ({ ready: true }) }, cfg).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual((await call('GET', '/api/auth/options')).json.data, { google: true, guest: true, password: false });
});

test('auth: email + password sign-in is turned off by default', { skip }, async () => {
  assert.equal(config.auth.passwordAuth, process.env.PASSWORD_AUTH === '1');
  for (const p of ['/api/auth/signup', '/api/auth/signin']) {
    const r = await call('POST', p, { email: 'x@example.com', password: 'correct horse battery' });
    assert.equal(r.status, 410); assert.equal(r.json.error.code, 'password_auth_disabled');
  }
});

test('auth: Google sign-in creates the account once, then signs in to it', { skip }, async () => {
  const start = await call('GET', '/api/auth/google/start');
  const url = new URL(start.location);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('redirect_uri'), `${base}/api/auth/google/callback`);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(start.cookies.nh_oauth && !start.location.includes('test-secret'));

  const first = await googleSignIn({ sub: 'g-1', email: 'Mei@Example.com', name: 'Mei' });
  assert.equal(first.status, 303); assert.equal(first.location, '/#/?signedin=google');
  assert.match(first.cookies.nh_session, /^[\w-]{40,}$/);
  const me = (await call('GET', '/api/auth/me', null, jar({ nh_session: first.cookies.nh_session }))).json.data;
  assert.deepEqual({ ...me, learner: { name: me.learner.name } }, { signedIn: true, guest: false, email: 'mei@example.com', learner: { name: 'Mei' } });
  assert.match(me.learner.id, /^learner:[0-9a-f-]{36}$/);

  const again = await googleSignIn({ sub: 'g-1', email: 'mei@example.com', name: 'Mei' });
  assert.equal((await call('GET', '/api/auth/me', null, jar({ nh_session: again.cookies.nh_session }))).json.data.learner.id, me.learner.id);
  const stored = await client.query("MATCH (a:Account {googleSub: 'g-1'}) RETURN count(a) AS n, collect(a.passwordHash)[0] AS h");
  assert.equal(stored[0].n, 1); assert.equal(stored[0].h, null);
  // a different Google identity with the same email is refused
  assert.equal((await googleSignIn({ sub: 'g-2', email: 'mei@example.com' })).location, '/#/signin?error=email_taken');
});

test('auth: the Google callback refuses a wrong state, a cancelled consent and an unverified email', { skip }, async () => {
  const start = await call('GET', '/api/auth/google/start');
  const forged = await call('GET', '/api/auth/google/callback?code=c&state=forged', null, jar({ nh_oauth: start.cookies.nh_oauth }));
  assert.equal(forged.location, '/#/signin?error=google_state'); assert.equal(forged.cookies.nh_session, undefined);
  const state = new URL(start.location).searchParams.get('state');
  assert.equal((await call('GET', `/api/auth/google/callback?code=c&state=${state}`)).location, '/#/signin?error=google_state'); // no flow cookie
  assert.equal((await call('GET', '/api/auth/google/callback?error=access_denied')).location, '/#/signin?error=google_cancelled');
  assert.equal((await googleSignIn({ sub: 'g-3', email: 'u@example.com', email_verified: false })).location, '/#/signin?error=google_unverified');
});

test('auth: a guest gets its own learner; signing in with Google keeps its progress', { skip }, async () => {
  const g = await call('POST', '/api/auth/guest', {});
  assert.equal(g.status, 201);
  const G = jar({ nh_session: g.cookies.nh_session });
  const me = g.json.data;
  assert.equal(me.signedIn, true); assert.equal(me.guest, true); assert.equal(me.email, undefined);
  assert.notEqual(me.learner.id, 'learner:demo');
  assert.equal((await call('POST', '/api/auth/guest', {}, G)).json.data.learner.id, me.learner.id, 'no second guest for the same browser');

  const s = (await call('POST', '/api/sessions', { sessionId: 'guest-s1' }, G)).json.data;
  assert.equal((await call('POST', '/api/attempts', { sessionId: 'guest-s1', exerciseId: s.exercises[0].id, attemptId: 'guest-a1', answer: 'zzz' }, G)).status, 200);
  assert.equal((await call('GET', '/api/dashboard', null, G)).json.data.learner.id, me.learner.id);

  const up = await googleSignIn({ sub: 'g-guest', email: 'kai@example.com', name: 'Kai' }, g.cookies.nh_session);
  assert.equal(up.location, '/#/?signedin=google');
  const K = jar({ nh_session: up.cookies.nh_session });
  const after = (await call('GET', '/api/auth/me', null, K)).json.data;
  assert.equal(after.learner.id, me.learner.id); assert.equal(after.guest, false); assert.equal(after.email, 'kai@example.com'); assert.equal(after.learner.name, 'Kai');
  assert.equal((await call('GET', '/api/sessions/guest-s1', null, K)).status, 200);
  assert.equal((await call('GET', '/api/dashboard', null, G)).status, 401, 'the guest cookie no longer works');
});

test('auth: a guest signing in to an existing account leaves the guest behind; guest sign-out deletes it', { skip }, async () => {
  const g = await call('POST', '/api/auth/guest', {});
  const guestLearner = g.json.data.learner.id;
  const r = await googleSignIn({ sub: 'g-1', email: 'mei@example.com' }, g.cookies.nh_session);
  assert.equal(r.location, '/#/?signedin=google&guest=left');
  assert.equal(await env.memory.getLearner(guestLearner), null, 'the unreachable guest learner is deleted');

  const g2 = await call('POST', '/api/auth/guest', {});
  const out = await call('POST', '/api/auth/signout', {}, jar({ nh_session: g2.cookies.nh_session }));
  assert.equal(out.json.data.signedIn, false);
  assert.equal(await env.memory.getLearner(g2.json.data.learner.id), null);
  assert.equal((await client.query("MATCH (a:Account {kind: 'guest'}) RETURN count(a) AS n"))[0].n, 0);
});

test('auth: guest sign-ins are renewed while used; abandoned guests are pruned', { skip }, async () => {
  let now = Date.now();
  const auth = new AuthService({ memory: env.memory, guestTtlMs: 10_000, clock: () => now });
  const g = await auth.startGuest();
  assert.equal((await auth.resolve(g.token)).renewedUntil, undefined);
  now += 6_000;
  const renewed = await auth.resolve(g.token);
  assert.equal(renewed.guest, true); assert.equal(renewed.renewedUntil, now + 10_000);
  now += 9_000;
  assert.ok(await auth.resolve(g.token), 'still signed in after the original expiry');

  const idle = await auth.startGuest();
  await env.memory.pruneAuthSessions(now + 20_000);
  assert.equal(await env.memory.pruneGuests(), 2);
  assert.equal(await env.memory.getLearner(idle.auth.learnerId), null);
  assert.ok(await env.memory.getAccountByGoogleSub('g-1'), 'Google accounts are never pruned');
});

test('auth: the renewed guest cookie is sent back', { skip }, async () => {
  const short = new AuthService({ memory: env.memory, guestTtlMs: 1000 });
  const saved = env.auth; env.auth = short;
  try {
    const g = await call('POST', '/api/auth/guest', {});
    await new Promise((r) => setTimeout(r, 600));
    const r = await call('GET', '/api/auth/me', null, jar({ nh_session: g.cookies.nh_session }));
    assert.equal(r.cookies.nh_session, g.cookies.nh_session);
  } finally { env.auth = saved; }
});

test('auth: Google sign-in links an existing email + password account', { skip }, async () => {
  const pw = new AuthService({ memory: env.memory });
  const old = await pw.signUp({ email: 'ren@example.com', password: 'correct horse battery', name: 'Ren' });
  const r = await googleSignIn({ sub: 'g-ren', email: 'ren@example.com', name: 'Ren G' });
  const me = (await call('GET', '/api/auth/me', null, jar({ nh_session: r.cookies.nh_session }))).json.data;
  assert.equal(me.learner.id, old.auth.learnerId); assert.equal(me.learner.name, 'Ren', 'the existing name is kept');
});

test('auth teardown', { skip }, async () => { server?.close(); if (client) await teardown(client); });
