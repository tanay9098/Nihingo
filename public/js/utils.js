// Tiny DOM helpers. All dynamic text goes through textContent — never innerHTML — so data from the
// graph (or from users) can't inject markup.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'vars') for (const [n, val] of Object.entries(v)) el.style.setProperty(n, val);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const svg = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function ago(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  const m = Math.round(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 48) return `${hr} h ago`;
  return `${Math.round(hr / 24)} days ago`;
}

let toastTimer;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

export const demoBadge = (isDemo) => (isDemo ? h('span', { class: 'badge demo', title: 'Pre-seeded demo data, not activity by the current user' }, 'demo data') : null);
export const statusBadge = (s) => {
  if (!s) return null;
  const cls = { struggling: 'bad', mastered: 'ok', learning: 'warn' }[s] || '';
  return h('span', { class: `badge ${cls}` }, s);
};

const RULES = {
  'recurring-mistake': 'Recurring mistake on one concept',
  'prerequisite-gap': 'Weak prerequisite in the concept graph',
  'confusable-pair': 'Two confusable concepts both missed',
  'listening-gap': 'Low listening comprehension rating',
  overdue: 'Items overdue for spaced review',
  'first-session': 'No history yet',
  'next-in-sequence': 'Nothing urgent: next in sequence',
  'topic-overlap': 'Shares a topic with today\'s focus',
  'newest-unwatched': 'Newest unwatched lesson',
};

/** Human-readable evidence lines built only from fields the Planner stored with the recommendation. */
export function evidenceLines(rec) {
  const e = rec.evidence || {};
  const out = [`Rule applied: ${RULES[e.rule] || e.rule || 'n/a'}`];
  if (e.stage) out.push(`Learning path: step ${e.stage.step} of ${e.stage.of} — ${e.stage.title} (${e.stage.module})`);
  if (e.mistakeCount) {
    let line = `${plural(e.mistakeCount, 'mistake')} recorded in ${plural(e.sessionCount, 'session')}`;
    if (e.demoMistakes) line += ` (${e.demoMistakes} from seeded demo history, ${e.liveMistakes} from live answers)`;
    out.push(line);
  }
  if (e.mastery != null) out.push(`Estimated mastery ${e.mastery} (conservative lower bound), status “${e.status || 'n/a'}”`);
  if (e.prerequisite) out.push(`Graph path: ${rec.focusName} ← REQUIRES — “${e.prerequisite.name}” (${e.prerequisite.attempts ? `mastery ${e.prerequisite.mastery}` : 'not practised yet'})`);
  if (e.contrast) out.push(`Graph path: CONTRASTS_WITH — “${e.contrast.name}” (${plural(e.contrast.mistakes, 'mistake')})`);
  if (e.path) out.push(`Graph path: concept → topic “${e.path.topic}” → lesson`);
  if (e.dueCount) out.push(`${plural(e.dueCount, 'item')} currently due for review`);
  if (e.difficulty) out.push(`Lesson level: ${e.difficulty}`);
  out.push(`Computed from learner memory version ${e.stateVersion ?? '?'}`);
  return out;
}

export function whyBox(rec, open = false) {
  return h('details', { class: 'why', open }, h('summary', {}, 'Why this recommendation?'),
    h('ul', { class: 'evidence' }, evidenceLines(rec).map((l) => h('li', {}, l))));
}
