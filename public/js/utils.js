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

// Events logged before the plain-language wording carry raw mastery numbers in the tutor's message (same rewrite as plainReason in tutor.js).
const legacyMessage = (text) => text
  .replace(/ \(estimated mastery ([\d.]+)\)\./, (_, m) => `, so it is only about ${pct(Number(m))} learned.`)
  .replace(/which your memory estimates at only ([\d.]+)/, (_, m) => `which you know only about ${pct(Number(m))}`)
  .replace('which your memory shows you have not practised yet', 'which you have not practised yet');

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
      return [`Suggested: ${o.title || 'your next step'}${f ? ` (${f})` : ''}.`, o.message ? legacyMessage(o.message) : null, o.listening ? `Also suggested listening: ${o.listening}.` : null];
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
  'recurring-mistake': 'You keep missing the same item',
  'prerequisite-gap': 'Something it builds on needs work first',
  'confusable-pair': 'Two similar items are getting mixed up',
  'listening-gap': 'A listening lesson felt hard',
  overdue: 'Some items are due for review',
  'first-session': 'You are just getting started',
  'next-in-sequence': 'Nothing needs revision, so you move on to the next step',
  'topic-overlap': 'It covers the same topic as what you are studying',
  'newest-unwatched': 'It is the newest lesson you have not watched',
};

/** Plain-language evidence lines built only from fields the Planner stored with the recommendation. */
export function evidenceLines(rec) {
  const e = rec.evidence || {};
  const out = [`Reason: ${RULES[e.rule] || 'Picked from your progress'}`];
  if (e.stage) out.push(`Your learning path: step ${e.stage.step} of ${e.stage.of} — ${e.stage.title} (${e.stage.module})`);
  if (e.mistakeCount) {
    let line = `${plural(e.mistakeCount, 'mistake')} over ${plural(e.sessionCount, 'session')}`;
    if (e.demoMistakes) line += ` (${e.demoMistakes} from the demo history, ${e.liveMistakes} from your own answers)`;
    out.push(line);
  }
  if (e.mastery != null) out.push(`How well you know it: about ${pct(e.mastery)} (a cautious estimate)${e.status ? ` · ${STATUS_LABEL[e.status] || e.status}` : ''}`);
  if (e.prerequisite) out.push(`It builds on “${e.prerequisite.name}”, which ${e.prerequisite.attempts ? `you know about ${pct(e.prerequisite.mastery)}` : 'you have not practised yet'}`);
  if (e.contrast) out.push(`Easy to confuse with “${e.contrast.name}” (${plural(e.contrast.mistakes, 'mistake')})`);
  if (e.path) out.push(`Shares the topic “${e.path.topic}” with what you are studying`);
  if (e.dueCount) out.push(`${plural(e.dueCount, 'item')} ${e.dueCount === 1 ? 'is' : 'are'} due for review`);
  if (e.difficulty) out.push(`Lesson level: ${e.difficulty}`);
  out.push('Based on your latest answers');
  return out;
}

// --- library item popup: plain wording for practice questions and related items
const FORMAT_COUNT = { multiple_choice: ['multiple choice', 'multiple choice'], typed: ['typed answer', 'typed answers'], flashcard: ['flashcard', 'flashcards'] };

/** "6 practice questions: 4 multiple choice, 2 typed answers" from the item's exercises (format only, no internal type names). */
export function practiceLine(exercises = []) {
  if (!exercises.length) return null;
  const n = {};
  for (const e of exercises) n[e.format] = (n[e.format] || 0) + 1;
  const parts = Object.keys(FORMAT_COUNT).filter((f) => n[f]).map((f) => `${n[f]} ${FORMAT_COUNT[f][n[f] === 1 ? 0 : 1]}`);
  return `${plural(exercises.length, 'practice question')}${parts.length ? `: ${parts.join(', ')}` : ''}`;
}

/** Plain label for a related item ("Used in", "Builds on", …), deduplicated so a two-way link shows once. */
export function relatedItems(related = []) {
  const label = (r) => ({ APPEARS_IN: r.outgoing ? 'Used in' : 'Contains', REQUIRES: r.outgoing ? 'Builds on' : 'Needed for', CONTRASTS_WITH: 'Easy to confuse with' }[r.rel] || 'Related to');
  const seen = new Set();
  return related.map((r) => ({ ...r, label: label(r) })).filter((r) => !seen.has(`${r.label}|${r.id}`) && seen.add(`${r.label}|${r.id}`));
}

// --- learning map: summary line and the card shown when an item is clicked
const KIND_WORDS = { kana: ['letter (kana)', 'letters (kana)'], vocabulary: ['word', 'words'], grammar: ['grammar point', 'grammar points'], kanji: ['kanji', 'kanji'] };
const kindCount = (k, n) => `${n} ${(KIND_WORDS[k] || ['item', 'items'])[n === 1 ? 0 : 1]}`;
const joinAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** One plain sentence about what the learner is practising and what needs the most work, from the memory view's concepts. */
export function mapSummary(concepts = []) {
  if (!concepts.length) return 'You haven’t practised anything yet. Start a session from Today and your map will grow.';
  const counts = {};
  for (const c of concepts) counts[c.kind] = (counts[c.kind] || 0) + 1;
  const kinds = Object.keys(KIND_WORDS).filter((k) => counts[k]).concat(Object.keys(counts).filter((k) => !KIND_WORDS[k]));
  let out = `You’re practising ${joinAnd(kinds.map((k) => kindCount(k, counts[k])))}.`;
  const strong = concepts.filter((c) => c.status === 'mastered').length;
  if (strong) out += ` You know ${strong === concepts.length ? (strong === 1 ? 'it' : 'all of them') : strong} well.`;
  const open = concepts.filter((c) => c.status !== 'mastered');
  const weakest = [...open].sort((a, b) => (b.status === 'struggling') - (a.status === 'struggling') || (a.mastery ?? 0) - (b.mastery ?? 0))[0];
  if (weakest) out += ` ${weakest.name} needs the most practice (about ${pct(weakest.mastery)} known).`;
  return out;
}

const GROUP_WORDS = { kana: 'Letter (kana)', vocabulary: 'Word', grammar: 'Grammar point', kanji: 'Kanji', Topic: 'Topic', Lesson: 'Listening lesson', Resource: 'Lesson source', Learner: 'Learner' };
const STATUS_HINT = {
  struggling: 'This one needs revision. It will come up again in your next sessions.',
  learning: 'You’re getting there. It will come back for review so it sticks.',
  mastered: 'You know this well. It will still come back now and then so you don’t forget it.',
  new: 'You’ve only just started on this one.',
};

/** What the info card says about a clicked map item. `studied` is the learner's progress on it (from the memory view), if any. */
export function itemInfo(node, studied) {
  const kind = GROUP_WORDS[node.group] || 'Item';
  const lines = [];
  const links = [];
  if (KIND_WORDS[node.group]) {
    if (studied) {
      lines.push(`${STATUS_LABEL[studied.status] ? `${STATUS_LABEL[studied.status][0].toUpperCase()}${STATUS_LABEL[studied.status].slice(1)} · ` : ''}about ${pct(studied.mastery)} known · practised ${studied.attempts === 1 ? 'once' : `${studied.attempts ?? 0} times`}.`);
      if (STATUS_HINT[studied.status]) lines.push(STATUS_HINT[studied.status]);
    } else lines.push('You haven’t practised this yet. It is linked to something you are learning.');
    links.push(['Look it up in the library', `#/library?item=${encodeURIComponent(node.id)}`]);
  } else if (node.group === 'Topic') {
    lines.push('A topic groups related items. Show its links to see what belongs to it.');
    links.push(['Browse this topic', `#/library?tab=all&topic=${encodeURIComponent(node.label)}`]);
  } else if (node.group === 'Lesson') {
    lines.push('A listening lesson that covers something you are learning.');
    links.push(['Go to listening', '#/listening']);
  } else if (node.group === 'Resource') {
    lines.push('A file the app’s lessons were taken from.');
  }
  return { title: node.label, kind, lines, links };
}

export function whyBox(rec, open = false) {
  return h('details', { class: 'why', open }, h('summary', {}, 'Why this recommendation?'),
    h('ul', { class: 'evidence' }, evidenceLines(rec).map((l) => h('li', {}, l))));
}
