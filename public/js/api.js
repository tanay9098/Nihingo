// All server communication. The browser only ever talks to this app's own /api; it never sees
// database credentials or API keys.
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'network' } = {}) { super(message); this.status = status; this.code = code; }
}

let learnerId = 'learner:demo';
try { learnerId = localStorage.getItem('learner') || learnerId; } catch { /* storage may be blocked */ }
export const getLearner = () => learnerId;
export function setLearner(id) { learnerId = id; try { localStorage.setItem('learner', id); } catch { /* ignore */ } }

async function request(method, path, body, { timeout = 15000 } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method, signal: AbortSignal.timeout(timeout),
      headers: { 'x-learner-id': learnerId, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError(err.name === 'TimeoutError' ? 'The server took too long to respond.' : 'Cannot reach the server. Check your connection and try again.', { code: 'network' });
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok || !json?.ok) {
    throw new ApiError(json?.error?.message || `Request failed (${res.status})`, { status: res.status, code: json?.error?.code || 'http' });
  }
  return json.data;
}

export const api = {
  health: () => request('GET', '/health'),
  dashboard: () => request('GET', '/dashboard'),
  library: (params) => request('GET', `/library?${new URLSearchParams(params)}`),
  libraryItem: (id) => request('GET', `/library/item?id=${encodeURIComponent(id)}`),
  topics: () => request('GET', '/library/topics'),
  kanjiRefs: () => request('GET', '/library/kanji-references'),
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
