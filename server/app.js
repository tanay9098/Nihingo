import express from 'express';
import { config, appMode } from './config.js';
import { DEMO_LEARNER, HttpError } from './services/learning.js';
import { PREF_RULES } from './agents/planner.js';
import { seedDemo } from './seed/demo.js';

const ID_RE = /^[\p{L}\p{N}._:\-\/]{1,160}$/u; // Unicode letters allowed: concept ids contain Japanese text
const ok = (res, data, status = 200) => res.status(status).json({ ok: true, data });
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function str(v, name, { max = 300, required = true } = {}) {
  if (v == null || v === '') { if (required) throw new HttpError(400, `${name} is required`, 'validation'); return ''; }
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, `${name} must be a string of at most ${max} characters`, 'validation');
  return v;
}
function id(v, name, required = true) {
  const s = str(v, name, { max: 160, required });
  if (s && !ID_RE.test(s)) throw new HttpError(400, `${name} has an invalid format`, 'validation');
  return s;
}
const int = (v, def, min, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

const SESSION_COOKIE = 'nh_session';
// Holds the OAuth state, PKCE verifier and nonce between /auth/google/start and the callback.
const OAUTH_COOKIE = 'nh_oauth';
function readCookie(req, name) {
  for (const part of (req.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

/** Fixed-window counter per key; returns false once `max` hits have been seen inside the window. */
function rateLimiter({ max, windowMs }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    if (hits.size > 10_000) for (const [k, h] of hits) if (now - h.start > windowMs) hits.delete(k);
    const h = hits.get(key);
    if (!h || now - h.start > windowMs) { hits.set(key, { start: now, n: 1 }); return true; }
    return ++h.n <= max;
  };
}

/**
 * @param {{ get: () => Promise<{service:any, catalog:any, memory:any, client:any, rag:any}>, state: () => object }} ctx
 */
export function createApp(ctx, cfg = config) {
  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https://i.ytimg.com data:; frame-src https://www.youtube-nocookie.com https://www.youtube.com; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'");
    next();
  });
  app.use(express.json({ limit: '20kb' }));

  const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: cfg.auth.cookieSecure, path: '/' };
  const authAttempt = rateLimiter({ max: 20, windowMs: 10 * 60 * 1000 });

  const api = express.Router();
  api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  // The session cookie is SameSite=Lax; also refuse writes that a browser says came from another site.
  api.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && !['GET', 'HEAD'].includes(req.method)) {
      let host = null; try { host = new URL(origin).host; } catch { /* malformed */ }
      if (host !== req.get('host')) throw new HttpError(403, 'Cross-site requests are not allowed', 'cross_origin');
    }
    next();
  });

  // The health endpoint works even when the database is down.
  api.get('/health', asyncH(async (req, res) => {
    const st = ctx.state();
    if (!st.ready) return res.status(503).json({ ok: false, error: { code: 'db_unavailable', message: st.error || 'Starting up…' }, data: { mode: appMode(cfg), falkordb: { ok: false } } });
    const s = await ctx.get();
    let latencyMs = null, up = true;
    try { latencyMs = await s.client.ping(); } catch { up = false; }
    const counts = up ? await s.catalog.counts() : null;
    ok(res, { status: up ? 'ok' : 'degraded', mode: appMode(cfg), falkordb: { ok: up, latencyMs, graph: cfg.falkor.graph }, counts, graphrag: { sidecarConfigured: !!cfg.ragUrl }, bootstrap: st.bootstrap ?? null });
  }));

  // Who is asking. A signed-in account always works on its own learner (from the session cookie, never from the
  // request); `X-Learner-Id` can only switch to the demo learner. A visitor without any account (not even a guest one) sees the demo learner.
  api.use(asyncH(async (req, res, next) => {
    try { req.s = await ctx.get(); } catch (e) { throw new HttpError(503, 'The graph database is not reachable yet. Please retry in a moment.', 'db_unavailable'); }
    req.token = readCookie(req, SESSION_COOKIE);
    req.auth = req.token ? await req.s.auth.resolve(req.token) : null;
    if (req.token && !req.auth) {
      res.clearCookie(SESSION_COOKIE, cookieOpts);
      if (!req.path.startsWith('/auth/')) throw new HttpError(401, 'Your sign-in has expired. Please sign in again.', 'session_expired');
    }
    if (req.auth?.renewedUntil) res.cookie(SESSION_COOKIE, req.token, { ...cookieOpts, expires: new Date(req.auth.renewedUntil) });
    const asked = req.get('x-learner-id');
    if (asked && asked !== DEMO_LEARNER.id && asked !== req.auth?.learnerId) {
      throw req.auth ? new HttpError(403, 'That learner profile belongs to another account', 'forbidden') : new HttpError(401, 'Sign in to use your own learner profile', 'auth_required');
    }
    req.learnerId = asked || req.auth?.learnerId || DEMO_LEARNER.id;
    next();
  }));

  // ----- accounts
  const meView = async (req, auth) => {
    if (!auth) return { signedIn: false, learner: { id: DEMO_LEARNER.id, name: DEMO_LEARNER.name } };
    const l = await req.s.memory.getLearner(auth.learnerId);
    const learner = { id: auth.learnerId, name: l?.name ?? '' };
    // A guest has its own learner too (so `signedIn` is true), but no email and nothing but this browser's cookie.
    return auth.guest ? { signedIn: true, guest: true, learner } : { signedIn: true, guest: false, email: auth.email, learner };
  };
  const limitAuth = (req) => { if (!authAttempt(req.ip)) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.', 'rate_limited'); };
  const signedIn = async (req, res, r, status) => {
    if (req.token) await req.s.auth.signOut(req.token);
    res.cookie(SESSION_COOKIE, r.token, { ...cookieOpts, expires: new Date(r.expiresAt) });
    ok(res, await meView(req, r.auth), status);
  };
  const passwordAuth = () => {
    if (!cfg.auth.passwordAuth) throw new HttpError(410, 'Email and password sign-in is turned off. Continue with Google instead.', 'password_auth_disabled');
  };
  api.get('/auth/me', asyncH(async (req, res) => ok(res, await meView(req, req.auth))));
  api.get('/auth/options', (req, res) => ok(res, { google: !!req.s.google?.enabled, guest: true, password: !!cfg.auth.passwordAuth }));
  api.post('/auth/guest', asyncH(async (req, res) => {
    if (req.auth) return ok(res, await meView(req, req.auth));
    limitAuth(req);
    await signedIn(req, res, await req.s.auth.startGuest(), 201);
  }));

  // Sign in with Google: a browser navigation (not fetch) to /start, Google's consent screen, then back to /callback,
  // which sets the session cookie and redirects into the app. Errors come back as #/signin?error=<code>.
  const oauthCookie = { ...cookieOpts, path: '/api/auth/google' };
  const redirectUri = (req) => cfg.google.redirectUri || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  api.get('/auth/google/start', asyncH(async (req, res) => {
    if (!req.s.google?.enabled) return res.redirect(303, '/#/signin?error=google_disabled');
    const { url, flow } = req.s.google.start(redirectUri(req));
    res.cookie(OAUTH_COOKIE, Buffer.from(JSON.stringify(flow)).toString('base64url'), { ...oauthCookie, maxAge: 10 * 60 * 1000 });
    res.redirect(303, url);
  }));
  api.get('/auth/google/callback', asyncH(async (req, res) => {
    const fail = (code) => res.redirect(303, `/#/signin?error=${encodeURIComponent(code)}`);
    let flow = null;
    try { flow = JSON.parse(Buffer.from(readCookie(req, OAUTH_COOKIE), 'base64url').toString('utf8')); } catch { /* missing or mangled */ }
    res.clearCookie(OAUTH_COOKIE, oauthCookie);
    if (!req.s.google?.enabled) return fail('google_disabled');
    const { code, state, error } = req.query;
    if (error) return fail(error === 'access_denied' ? 'google_cancelled' : 'google_failed');
    if (typeof flow?.state !== 'string' || typeof state !== 'string' || state !== flow.state || typeof code !== 'string' || !code || code.length > 2048) return fail('google_state');
    if (!authAttempt(req.ip)) return fail('rate_limited');
    let r;
    try {
      const identity = await req.s.google.finish({ code, redirectUri: redirectUri(req), flow });
      r = await req.s.auth.signInWithGoogle({ ...identity, current: req.auth });
    } catch (err) {
      if (err instanceof HttpError) return fail(err.code);
      throw err;
    }
    if (req.token) await req.s.auth.signOut(req.token);
    res.cookie(SESSION_COOKIE, r.token, { ...cookieOpts, expires: new Date(r.expiresAt) });
    res.redirect(303, `/#/?signedin=google${r.guestLeft ? '&guest=left' : ''}`);
  }));

  api.post('/auth/signup', asyncH(async (req, res) => {
    passwordAuth();
    limitAuth(req);
    const b = req.body ?? {};
    await signedIn(req, res, await req.s.auth.signUp({
      email: str(b.email, 'email', { max: 254 }), password: str(b.password, 'password', { max: 128 }), name: str(b.name, 'name', { max: 60, required: false }),
    }), 201);
  }));
  api.post('/auth/signin', asyncH(async (req, res) => {
    passwordAuth();
    limitAuth(req);
    const b = req.body ?? {};
    await signedIn(req, res, await req.s.auth.signIn({ email: str(b.email, 'email', { max: 254 }), password: str(b.password, 'password', { max: 128 }) }));
  }));
  api.post('/auth/signout', asyncH(async (req, res) => {
    if (req.token) await req.s.auth.signOut(req.token);
    res.clearCookie(SESSION_COOKIE, cookieOpts);
    ok(res, await meView(req, null));
  }));

  api.get('/dashboard', asyncH(async (req, res) => ok(res, await req.s.service.dashboard(req.learnerId))));

  // ----- library (concepts) and resources (files)
  api.get('/library', asyncH(async (req, res) => {
    const kind = str(req.query.kind, 'kind', { max: 20, required: false });
    if (kind && !['vocabulary', 'kanji', 'kana', 'grammar'].includes(kind)) throw new HttpError(400, 'Unknown kind', 'validation');
    ok(res, await req.s.catalog.search({
      q: str(req.query.q, 'q', { max: 80, required: false }), kind, topic: str(req.query.topic, 'topic', { max: 40, required: false }),
      limit: int(req.query.limit, 24, 1, 200), offset: int(req.query.offset, 0, 0, 5000),
    }));
  }));
  api.get('/library/exercises', asyncH(async (req, res) => ok(res, await req.s.catalog.exerciseSummary())));
  api.get('/library/topics', asyncH(async (req, res) => ok(res, await req.s.catalog.topics())));
  api.get('/library/stroke-references', asyncH(async (req, res) => ok(res, await req.s.catalog.strokeReferences())));
  api.get('/library/item', asyncH(async (req, res) => {
    const item = await req.s.catalog.getConcept(id(req.query.id, 'id'));
    if (!item) throw new HttpError(404, 'Item not found', 'not_found');
    const states = await req.s.memory.getStudyStates(req.learnerId, [item.id]);
    ok(res, { ...item, learnerState: states[item.id] ?? null });
  }));
  api.get('/resources', asyncH(async (req, res) => ok(res, await req.s.catalog.listResources({ limit: int(req.query.limit, 100, 1, 200), offset: int(req.query.offset, 0, 0, 5000) }))));
  api.get('/resources/:id', asyncH(async (req, res) => {
    const r = await req.s.catalog.getResource(id(req.params.id, 'id'));
    if (!r) throw new HttpError(404, 'Resource not found', 'not_found');
    ok(res, r);
  }));

  // ----- listening
  api.get('/listening', asyncH(async (req, res) => {
    const [lessons, logs] = await Promise.all([req.s.catalog.listLessons(req.learnerId), req.s.memory.listeningLogs(req.learnerId, 30)]);
    ok(res, { lessons, logs, source: { name: 'Lazy Benkyou', website: 'https://lazybenkyou.com/', start: 'https://lazybenkyou.com/start', youtube: 'https://www.youtube.com/@LazyBenkyou' } });
  }));
  api.post('/listening/:lessonId/log', asyncH(async (req, res) => {
    const lessonId = id(req.params.lessonId, 'lessonId');
    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'rating must be an integer from 1 to 5', 'validation');
    const note = str(req.body.note, 'note', { max: 500, required: false });
    const logId = id(req.body.logId || `ll:${req.learnerId}:${lessonId}:${Date.now()}`, 'logId');
    const lessons = await req.s.catalog.listLessons(req.learnerId);
    if (!lessons.find((l) => l.id === lessonId)) throw new HttpError(404, 'Lesson not found', 'not_found');
    if (!(await req.s.memory.logListening({ id: logId, learnerId: req.learnerId, lessonId, rating, note, at: Date.now(), isDemo: false }))) {
      throw new HttpError(409, 'logId is already in use', 'conflict');
    }
    await req.s.memory.bumpMemoryVersion(req.learnerId);
    ok(res, { logged: true, logId });
  }));
  api.post('/listening/:lessonId/save', asyncH(async (req, res) => {
    const lessonId = id(req.params.lessonId, 'lessonId');
    await req.s.memory.setSaved(req.learnerId, lessonId, req.body.saved !== false);
    ok(res, { saved: req.body.saved !== false });
  }));

  // ----- learner memory
  api.get('/learner/memory', asyncH(async (req, res) => ok(res, await req.s.service.memoryView(req.learnerId))));
  api.get('/learner/sessions', asyncH(async (req, res) => ok(res, await req.s.memory.recentSessions(req.learnerId, int(req.query.limit, 10, 1, 50)))));
  api.post('/learner/reset', asyncH(async (req, res) => {
    if (req.body.confirm !== true) throw new HttpError(400, 'Send {"confirm": true} to reset learning progress', 'confirm_required');
    if (req.learnerId === DEMO_LEARNER.id) {
      await seedDemo({ service: req.s.service, memory: req.s.memory });
      return ok(res, { reset: true, reseeded: true });
    }
    await req.s.service.resetLearner(req.learnerId);
    ok(res, { reset: true, reseeded: false });
  }));

  // ----- sessions / attempts
  api.post('/sessions', asyncH(async (req, res) => {
    ok(res, await req.s.service.startSession(req.learnerId, id(req.body.sessionId, 'sessionId', false) || undefined), 201);
  }));
  api.get('/sessions/:id', asyncH(async (req, res) => {
    const s = await req.s.memory.getSession(id(req.params.id, 'id'));
    if (!s || s.learnerId !== req.learnerId) throw new HttpError(404, 'Session not found', 'not_found');
    ok(res, await req.s.service.sessionView(s));
  }));
  api.post('/attempts', asyncH(async (req, res) => {
    const b = req.body;
    ok(res, await req.s.service.answer({
      learnerId: req.learnerId, sessionId: id(b.sessionId, 'sessionId'), exerciseId: id(b.exerciseId, 'exerciseId'),
      attemptId: id(b.attemptId, 'attemptId', false) || undefined, answer: str(typeof b.answer === 'number' ? String(b.answer) : b.answer, 'answer', { max: 300 }), ms: int(b.ms, 0, 0, 3_600_000),
    }));
  }));
  // Flashcards are self-graded, so the card back may be shown before rating — only for exercises in the learner's own session.
  api.get('/sessions/:sid/reveal/:exerciseId', asyncH(async (req, res) => {
    const sid = id(req.params.sid, 'sid');
    const session = await req.s.memory.getSession(sid);
    if (!session || session.learnerId !== req.learnerId) throw new HttpError(404, 'Session not found', 'not_found');
    const exId = id(req.params.exerciseId, 'exerciseId');
    if (!(await req.s.memory.sessionExerciseIds(sid)).includes(exId)) throw new HttpError(400, 'Exercise is not part of this session', 'bad_exercise');
    const ex = await req.s.memory.getExercise(exId);
    if (ex.format !== 'flashcard') throw new HttpError(403, 'Only flashcards can be revealed', 'forbidden');
    const c = await req.s.catalog.getConcept(ex.conceptIds[0]);
    ok(res, { word: c.word, reading: c.reading, romaji: c.romaji, meaning: c.meaning, example: c.example, exampleReading: c.exampleReading, exampleMeaning: c.exampleMeaning });
  }));
  api.post('/sessions/:id/complete', asyncH(async (req, res) => {
    ok(res, await req.s.service.complete({ learnerId: req.learnerId, sessionId: id(req.params.id, 'id') }));
  }));

  // ----- recommendations / agents / graph
  api.get('/recommendations', asyncH(async (req, res) => ok(res, await req.s.service.tutor.brief({ learnerId: req.learnerId }))));
  api.get('/agents/timeline', asyncH(async (req, res) => {
    ok(res, await req.s.memory.events(req.learnerId, { limit: int(req.query.limit, 40, 1, 200), sessionId: id(req.query.sessionId, 'sessionId', false) }));
  }));
  api.get('/graph/neighborhood', asyncH(async (req, res) => {
    const center = id(req.query.center || req.learnerId, 'center');
    ok(res, await req.s.service.neighborhood(center, { depth: int(req.query.depth, 1, 1, 2), limit: int(req.query.limit, 40, 5, 80), all: req.query.all === '1', viewer: req.learnerId }));
  }));

  // ----- feedback (procedural memory) and tutor Q&A
  api.post('/feedback', asyncH(async (req, res) => {
    const type = str(req.body.type, 'type', { max: 30 });
    const p = req.s.service.planner;
    if (type === 'preference') {
      const key = str(req.body.key, 'key', { max: 40 });
      if (!PREF_RULES[key]) throw new HttpError(400, 'Unknown preference key', 'validation');
      await p.setPreference(req.learnerId, key, String(req.body.value));
    } else if (type === 'clear_preference') {
      await p.clearPreference(req.learnerId, str(req.body.key, 'key', { max: 40 }));
    } else if (type === 'exercise_feedback') {
      // "too easy"/"too hard" is stored as explicit procedural evidence and nudges session length / format.
      const verdict = str(req.body.verdict, 'verdict', { max: 12 });
      if (!['too_easy', 'too_hard', 'just_right'].includes(verdict)) throw new HttpError(400, 'verdict must be too_easy, too_hard or just_right', 'validation');
      await req.s.memory.upsertPreference({ learnerId: req.learnerId, key: 'last_difficulty_feedback', value: verdict, source: 'explicit', evidenceCount: 1, evidence: 'Learner feedback after a session' });
      await req.s.memory.bumpMemoryVersion(req.learnerId);
    } else throw new HttpError(400, 'Unknown feedback type', 'validation');
    ok(res, { saved: true, preferences: (await req.s.service.memoryView(req.learnerId)).procedural });
  }));
  api.post('/tutor/ask', asyncH(async (req, res) => ok(res, await req.s.rag.ask(str(req.body.question, 'question', { max: 200 })))));

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ ok: false, error: { code: 'not_found', message: 'No such endpoint' } }));
  app.use(express.static(cfg.publicDir, { maxAge: '1h', etag: true, extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message } });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ ok: false, error: { code: 'bad_json', message: 'Request body is not valid JSON' } });
    if (err.type === 'entity.too.large') return res.status(413).json({ ok: false, error: { code: 'too_large', message: 'Request body too large' } });
    if (err.status && err.status < 500) return res.status(err.status).json({ ok: false, error: { code: 'bad_request', message: err.message } });
    console.error('[error]', req.method, req.url, err);
    const down = /ECONN|socket|timeout|Connection/i.test(err.message || '');
    res.status(down ? 503 : 500).json({ ok: false, error: { code: down ? 'db_unavailable' : 'internal', message: down ? 'The graph database did not respond in time.' : 'Something went wrong on the server.' } });
  });
  return app;
}
