// All server communication. The browser only ever talks to this app's own /api; it never sees
// database credentials or API keys.
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'network' } = {}) { super(message); this.status = status; this.code = code; }
}

// Who is signed in comes from the server (an HttpOnly session cookie the page cannot read). A signed-in learner can
// switch to viewing the demo learner; a guest always sees the demo learner.
export const DEMO_LEARNER = 'learner:demo';
let me = { signedIn: false, learner: { id: DEMO_LEARNER, name: '' } };
let viewDemo = false;
try { viewDemo = localStorage.getItem('viewDemo') === '1'; } catch { /* storage may be blocked */ }
export const getMe = () => me;
export const setMe = (m) => { me = m; };
export const isDemoView = () => !me.signedIn || viewDemo;
export function setViewDemo(on) { viewDemo = on; try { localStorage.setItem('viewDemo', on ? '1' : '0'); } catch { /* ignore */ } }

async function request(method, path, body, { timeout = 15000 } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method, signal: AbortSignal.timeout(timeout),
      headers: { ...(isDemoView() ? { 'x-learner-id': DEMO_LEARNER } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError(err.name === 'TimeoutError' ? 'The server took too long to respond.' : 'Cannot reach the server. Check your connection and try again.', { code: 'network' });
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error page */ }
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('auth:expired'));
  if (!res.ok || !json?.ok) {
    throw new ApiError(json?.error?.message || `Request failed (${res.status})`, { status: res.status, code: json?.error?.code || 'http' });
  }
  return json.data;
}

export const api = {
  health: () => request('GET', '/health'),
  me: () => request('GET', '/auth/me'),
  authOptions: () => request('GET', '/auth/options'),
  startGuest: () => request('POST', '/auth/guest', {}),
  signUp: (body) => request('POST', '/auth/signup', body),
  signIn: (body) => request('POST', '/auth/signin', body),
  signOut: () => request('POST', '/auth/signout', {}),
  dashboard: () => request('GET', '/dashboard'),
  library: (params) => request('GET', `/library?${new URLSearchParams(params)}`),
  libraryItem: (id) => request('GET', `/library/item?id=${encodeURIComponent(id)}`),
  topics: () => request('GET', '/library/topics'),
  strokeRefs: () => request('GET', '/library/stroke-references'),
  exerciseSummary: () => request('GET', '/library/exercises'),
  resources: () => request('GET', '/resources'),
  listening: () => request('GET', '/listening'),
  logListening: (lessonId, body) => request('POST', `/listening/${encodeURIComponent(lessonId)}/log`, body),
  saveLesson: (lessonId, saved) => request('POST', `/listening/${encodeURIComponent(lessonId)}/save`, { saved }),
  memory: () => request('GET', '/learner/memory'),
  startSession: (sessionId) => request('POST', '/sessions', sessionId ? { sessionId } : {}, { timeout: 30000 }),
  session: (id) => request('GET', `/sessions/${encodeURIComponent(id)}`),
  reveal: (sid, exId) => request('GET', `/sessions/${encodeURIComponent(sid)}/reveal/${encodeURIComponent(exId)}`),
  answer: (body) => request('POST', '/attempts', body),
  complete: (id) => request('POST', `/sessions/${encodeURIComponent(id)}/complete`, {}, { timeout: 30000 }),
  recommendations: () => request('GET', '/recommendations'),
  timeline: (params = {}) => request('GET', `/agents/timeline?${new URLSearchParams(params)}`),
  neighborhood: (params) => request('GET', `/graph/neighborhood?${new URLSearchParams(params)}`),
  feedback: (body) => request('POST', '/feedback', body),
  reset: () => request('POST', '/learner/reset', { confirm: true }),
  ask: (question) => request('POST', '/tutor/ask', { question }, { timeout: 40000 }),
};
