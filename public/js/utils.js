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
export const STATUS_LABEL = { new: 'new', learning: 'getting there', struggling: 'needs revision', mastered: 'strong' };
export const statusBadge = (s) => {
  if (!s) return null;
  const cls = { struggling: 'bad', mastered: 'ok', learning: 'warn' }[s] || '';
  return h('span', { class: `badge ${cls}` }, STATUS_LABEL[s] || s);
};

// --- plain-language wording for learners (no ids, keys or raw data in the UI)
export const FORMAT_LABEL = { multiple_choice: 'multiple choice', typed: 'typed answers', flashcard: 'flashcards', any: 'no preference' };
export const AGENT_LABEL = { tutor: 'Your tutor', examiner: 'Quiz builder', memory_planner: 'Progress tracker' };
const ACTIVITY_LABEL = {
  revise_concept: 'Targeted revision', revise_prerequisite: 'Revise the basics first', contrast_revision: 'Compare look-alike items',
  topic_revision: 'Topic revision', review_due: 'Review what is due', new_material: 'Learn something new', listen: 'Listening practice',
};
const PLAN_REASON = {
  'recurring-mistake': 'you have missed it more than once', 'prerequisite-gap': 'it is needed for something you find hard',
  'confusable-pair': 'two similar items keep getting mixed up', 'listening-gap': 'a recent listening lesson felt hard',
  overdue: 'it is due for review', 'first-session': 'this is where every beginner starts', 'next-in-sequence': 'it is the next step on your path',
};
/** Display name for a concept id: from `names` (id → name) when known, else "kana:あ" → "あ"; never an internal slug. */
export const conceptName = (id, names = {}) => names[id] || (typeof id === 'string' && id.includes(':') ? id.slice(id.indexOf(':') + 1) : 'this item');
const focusNames = (focus) => (Array.isArray(focus) ? focus.map((f) => f.name || conceptName(f.id)).filter(Boolean).join(', ') : focus || '');

/** Plain-language label and value for a stored preference row. */
export function prefText(key, value) {
  if (key === 'session_length') return ['Questions per session', String(value)];
  if (key === 'preferred_format') return ['Question style you chose', FORMAT_LABEL[value] || value];
  if (key === 'include_listening') return ['Listening practice', String(value) === 'true' ? 'recommended' : 'not recommended'];
  if (key === 'revision_pace') return ['Revision pace', { fast: 'faster', normal: 'normal', slow: 'slower' }[value] || value];
  if (key === 'inferred_format') return ['Question style that suits you', FORMAT_LABEL[value] || value];
  if (key === 'last_difficulty_feedback') return ['Last session felt', { too_easy: 'too easy', too_hard: 'too hard', just_right: 'just right' }[value] || value];
  if (key.startsWith('affinity:')) return [`Score with ${FORMAT_LABEL[key.slice(9)] || key.slice(9)}`, `${value}%`];
  return [key.replace(/_/g, ' '), String(value)];
}

/** "affinity:typed=50%" / "inferred_format=typed" (Planner output) → a sentence. */
export function proceduralText(item) {
  const [key, value = ''] = String(item).split('=');
  if (key === 'inferred_format') return `You seem to do best with ${FORMAT_LABEL[value] || value}.`;
  if (key.startsWith('affinity:')) return `You got ${value} right with ${FORMAT_LABEL[key.slice(9)] || key.slice(9)}.`;
  return 'Noted how you like to study.';
}

const STUDY_CHANGE = /^STUDIES\((.+?)\): mastery ([\d.]+) → ([\d.]+), status (\w+) → (\w+)/;

/** One agent event → plain-language sentences built from its stored fields. Never shows raw data. */
export function describeEvent(e, names = {}) {
  const r = e.retrieved || {}, c = e.changed || {}, o = e.output || {};
  switch (e.action) {
    case 'retrieve_memory': {
      const n = (r.conceptsWithMistakes || []).length;
      return [`Looked at your study history: ${n ? `${plural(n, 'item')} with past mistakes` : 'no past mistakes'}.`,
        o.recommendationStale ? 'Something changed since last time, so a fresh plan was needed.' : r.storedRecommendation ? 'Your current plan is still up to date.' : null];
    }
    case 'recommend_and_explain': {
      const f = focusNames(r.focus);
      return [`Suggested: ${o.title || 'your next step'}${f ? ` (${f})` : ''}.`, o.message || null, o.listening ? `Also suggested listening: ${o.listening}.` : null];
    }
    case 'select_exercises': {
      const list = Array.isArray(o.exercises) ? o.exercises : [];
      const n = list.length || c.selectedEdges || 0;
      const f = focusNames(r.focus);
      const why = [...new Set(list.map((x) => x?.why?.replace(/\s*\([A-Z_]+\)/g, '')).filter(Boolean))]; // drop graph labels like (CONTRASTS_WITH)
      return [`Picked ${plural(n, 'question')}${f ? ` on ${f}` : ''}.`,
        r.preferredFormat ? `Question style: ${FORMAT_LABEL[r.preferredFormat] || r.preferredFormat}${r.formatSource === 'explicit' ? ' (your choice)' : ' (suits you best)'}.` : null,
        why.length ? `Why: ${why.join('; ')}.` : null];
    }
    case 'evaluate_answer':
      return [`Marked your answer on ${conceptName(r.concept, names)}: ${o.ambiguous ? 'accepted as a near match' : o.correct ? 'correct ✓' : 'not correct ✗'}.`];
    case 'update_memory': {
      const lines = (c.updated || []).map((u) => {
        const m = STUDY_CHANGE.exec(u);
        if (!m) return null;
        const [, id, a, b, sa, sb] = m;
        const level = a === b ? `still ${pct(Number(b))} known` : `${pct(Number(a))} → ${pct(Number(b))} known`;
        return `Updated your progress on ${conceptName(id, names)}: ${level}${sa !== sb ? `, now “${STATUS_LABEL[sb] || sb}”` : ''}.`;
      }).filter(Boolean);
      if (!lines.length) lines.push('Saved your answer to your progress.');
      if ((c.created || []).includes('Mistake')) lines.push('Saved this mistake so it can come back for revision.');
      return lines;
    }
    case 'close_session': {
      const score = o.score ?? c.score ?? 0;
      return [`Finished the session: you scored ${score}%${r.attemptsInSession != null ? ` (${r.correct ?? 0} of ${r.attemptsInSession} correct)` : ''}.`,
        ...(c.proceduralMemory || []).map(proceduralText)];
    }
    case 'plan_recommendation': {
      const reason = PLAN_REASON[o.rule];
      return [`Planned what to study next: ${ACTIVITY_LABEL[o.activity] || 'your next step'}${o.focus ? ` (${o.focus})` : ''}${reason ? `, because ${reason}` : ''}.`,
        o.listening ? `Also lined up listening: ${o.listening}.` : null];
    }
    default:
      return ['Updated your learning plan.'];
  }
}

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
