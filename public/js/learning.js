// Practice flow: Tutor briefing -> Examiner questions -> graded feedback -> summary with updated memory.
import { api } from './api.js';
import { h, clear, uuid, pct, statusBadge, whyBox, toast } from './utils.js';

const TYPE_LABEL = {
  vocab_mc_meaning: 'Word → meaning', vocab_en_to_jp: 'Meaning → word', vocab_mc_reading: 'Reading choice', type_reading: 'Type the reading',
  recall_meaning: 'Recall the meaning', flashcard: 'Flashcard', kana_mc_romaji: 'Kana → romaji', kana_mc_char: 'Romaji → kana',
  kanji_mc_meaning: 'Kanji meaning', kanji_mc_strokes: 'Stroke count', grammar_select: 'Grammar selection', sentence_completion: 'Sentence completion',
  grammar_mc_meaning: 'Grammar meaning', grammar_mc_point: 'Spot the grammar',
};
const ORIGIN = { original: ['Original exercise', 'src-original'], 'generated-from-source': ['Generated from source data', ''] };

const KEY = 'session';
const saved = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
const store = (id) => { try { id ? sessionStorage.setItem(KEY, id) : sessionStorage.removeItem(KEY); } catch { /* ignore */ } };

export async function render(main, { showError }) {
  const wantsStart = location.hash.includes('start=1');
  const resume = saved();
  if (!wantsStart && resume) {
    try { const v = await api.session(resume); if (v.session.status === 'active') return runSession(main, v, { showError }); } catch { store(null); }
  }
  if (wantsStart) { history.replaceState(null, '', '#/practice'); return begin(main, { showError }); }
  return intro(main, { showError });
}

function intro(main, ctx) {
  clear(main).append(h('div', { class: 'stack' }, h('h1', {}, 'Practice'),
    h('div', { class: 'card stack' },
      h('p', {}, 'A session is planned from your learner memory: the Tutor reads your history, the Examiner picks questions, and the Memory & Planner agent records the outcome.'),
      h('button', { class: 'btn primary', id: 'go' }, 'Start a session'))));
  main.querySelector('#go').addEventListener('click', () => begin(main, ctx));
}

async function begin(main, ctx) {
  clear(main).append(h('p', { class: 'loading' }, 'The Tutor is reading your memory and the Examiner is choosing questions…'));
  try {
    const v = await api.startSession();
    store(v.session.id);
    briefing(main, v, ctx);
  } catch (err) { ctx.showError(err, () => begin(main, ctx)); }
}

function briefing(main, v, ctx) {
  const b = v.briefing;
  clear(main).append(h('div', { class: 'stack' }, h('h1', {}, 'Before you start'),
    b ? h('div', { class: 'card hero stack' },
      h('div', { class: 'row' }, h('strong', {}, b.recommendation.title), h('span', { class: 'badge' }, 'Tutor')),
      h('p', {}, b.explanation.text), whyBox(b.recommendation),
      b.lesson.concepts.map((c) => h('div', { class: 'card flat' }, h('strong', { class: 'jp' }, c.name), c.pattern ? h('span', { class: 'muted' }, ` — ${c.pattern}`) : null,
        c.explanation ? h('p', {}, c.explanation) : c.meaning ? h('p', {}, `${c.reading || ''} ${c.meaning}`) : c.romaji ? h('p', {}, `${c.script ? `${c.script} · ` : ''}“${c.romaji}”`) : null,
        c.example ? h('p', { class: 'jp' }, c.example, h('span', { class: 'muted' }, ` ${c.exampleMeaning || ''}`)) : null)),
      b.lesson.sources.length ? h('p', { class: 'small muted' }, 'Source: ', b.lesson.sources.map((s) => `${s.title} (${s.source})`).join('; ')) : null) : null,
    h('div', { class: 'card' }, h('h2', {}, `${v.exercises.length} questions selected by the Examiner`),
      h('ul', { class: 'list' }, v.exercises.map((e, i) => h('li', {}, h('span', {}, `${i + 1}. ${TYPE_LABEL[e.type] || e.type}`), h('span', { class: 'small muted' }, e.reason))))),
    h('button', { class: 'btn primary', id: 'begin' }, 'Begin')));
  main.querySelector('#begin').addEventListener('click', () => runSession(main, v, ctx));
}

function runSession(main, v, ctx) {
  const exercises = v.exercises;
  const state = { i: Math.max(0, exercises.findIndex((e) => !e.answered)), outcomes: exercises.map((e) => (e.answered ? 'done' : null)) };
  if (exercises.every((e) => e.answered)) return finish(main, v, ctx);
  const showQ = () => question(main, v, state, ctx, showQ);
  showQ();
}

function dots(state) {
  return h('div', { class: 'progress-dots', 'aria-label': `Question ${state.i + 1}` },
    state.outcomes.map((o, i) => h('i', { class: i === state.i ? 'cur' : o === 'wrong' ? 'wrong' : o ? 'done' : '' })));
}

function question(main, v, state, ctx, next) {
  const ex = v.exercises[state.i];
  const attemptId = uuid(); // reused on retry so a network hiccup can never double-count an attempt
  const t0 = Date.now();
  const [originLabel, originCls] = ORIGIN[ex.origin] || [ex.origin, ''];
  const fb = h('div', { id: 'fb', 'aria-live': 'polite' });
  const body = h('div', { class: 'stack' });
  const card = h('section', { class: 'card', 'aria-label': 'Question' },
    dots(state),
    h('div', { class: 'row' }, h('span', { class: 'badge' }, TYPE_LABEL[ex.type] || ex.type), h('span', { class: `badge ${originCls}` }, originLabel), h('span', { class: 'small muted' }, ex.reason)),
    h('div', { class: `prompt${ex.prompt.length > 8 ? ' long' : ''}`, lang: 'ja' }, ex.prompt),
    body, fb);
  clear(main).append(h('div', { class: 'stack' }, card));

  let locked = false;
  const submit = async (answer, onResult) => {
    if (locked) return;
    locked = true;
    try {
      const r = await api.answer({ sessionId: v.session.id, exerciseId: ex.id, attemptId, answer: String(answer), ms: Date.now() - t0 });
      state.outcomes[state.i] = r.result.correct ? 'done' : 'wrong';
      onResult?.(r.result);
      showFeedback(fb, r.result, () => { state.i++; state.i >= v.exercises.length ? finish(main, v, ctx) : next(); }, state.i === v.exercises.length - 1);
    } catch (err) {
      locked = false;
      fb.replaceChildren(h('div', { class: 'error-box', role: 'alert' }, err.message, ' Your answer was not recorded; try again.'));
    }
  };

  if (ex.format === 'multiple_choice') {
    const grid = h('div', { class: 'choices', role: 'group', 'aria-label': 'Answer choices' });
    ex.choices.forEach((c, i) => grid.append(h('button', { class: 'choice', lang: 'ja', 'data-key': i + 1, onclick: (ev) => {
      const btn = ev.currentTarget;
      submit(c, (res) => {
        for (const b of grid.children) { b.disabled = true; if (b.textContent === res.expected) b.classList.add('correct'); }
        if (!res.correct) btn.classList.add('wrong');
      });
    } }, c)));
    body.append(grid);
    card.addEventListener('keydown', (e) => { const b = grid.querySelector(`[data-key="${e.key}"]`); if (b && !b.disabled && document.activeElement.tagName !== 'INPUT') b.click(); });
    grid.firstChild?.focus();
  } else if (ex.format === 'typed') {
    const input = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', lang: 'ja', 'aria-label': 'Your answer', placeholder: 'Type your answer' });
    const btn = h('button', { class: 'btn primary', onclick: () => input.value.trim() && submit(input.value.trim(), () => { input.disabled = true; btn.disabled = true; }) }, 'Check');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
    body.append(h('div', { class: 'answer-row' }, input, btn));
    queueMicrotask(() => input.focus());
  } else {
    flashcard(body, v, ex, submit);
  }
}

function flashcard(body, v, ex, submit) {
  const back = h('div', { class: 'card-flip', hidden: true });
  const reveal = h('button', { class: 'btn', onclick: async () => {
    reveal.disabled = true;
    try {
      const c = await api.reveal(v.session.id, ex.id);
      back.replaceChildren(h('div', { class: 'jp', lang: 'ja' }, h('strong', {}, `${c.reading || c.word}`), c.romaji ? ` (${c.romaji})` : ''), h('div', {}, c.meaning),
        c.example ? h('p', { class: 'jp', lang: 'ja' }, c.example, h('br'), c.exampleReading, h('br'), h('span', { class: 'muted' }, c.exampleMeaning)) : null);
      back.hidden = false; reveal.hidden = true; ratings.hidden = false;
    } catch (err) { reveal.disabled = false; toast(err.message); }
  } }, 'Show answer');
  const ratings = h('div', { class: 'rating', hidden: true, role: 'group', 'aria-label': 'How well did you recall it?' },
    [['1', 'Again'], ['2', 'Hard'], ['3', 'Good'], ['4', 'Easy']].map(([val, label]) => h('button', { class: 'btn', onclick: () => submit(val, () => { for (const b of ratings.children) b.disabled = true; }) }, label)));
  body.append(h('p', { class: 'prompt-sub' }, 'Try to recall the reading and meaning, then check.'), back, reveal, ratings);
}

function showFeedback(fb, r, onNext, last) {
  const cls = r.ambiguous ? 'amb' : r.correct ? 'ok' : 'bad';
  const head = r.ambiguous ? 'Accepted — flagged as ambiguous' : r.correct ? 'Correct' : 'Not quite';
  const moved = r.masteryAfter - r.masteryBefore;
  fb.replaceChildren(h('div', { class: `feedback ${cls}`, role: 'status' },
    h('strong', {}, head),
    !r.correct || r.ambiguous ? h('p', { lang: 'ja' }, 'Expected: ', h('strong', {}, r.expected)) : null,
    r.note ? h('p', {}, r.note) : null,
    r.explanation ? h('p', {}, r.explanation) : null,
    r.masteryBefore != null ? h('p', { class: 'small delta' }, `Memory update for “${r.concept || r.conceptId}”: estimated mastery ${r.masteryBefore} → ${r.masteryAfter} (${moved >= 0 ? '+' : ''}${moved.toFixed(3)}) · `, statusBadge(r.status)) : null,
    h('button', { class: 'btn primary', id: 'next', autofocus: true, onclick: onNext }, last ? 'Finish session' : 'Next')));
  fb.querySelector('#next').focus();
}

async function finish(main, v, ctx) {
  clear(main).append(h('p', { class: 'loading' }, 'The Memory & Planner agent is updating your learner memory…'));
  let r;
  try { r = await api.complete(v.session.id); } catch (err) { return ctx.showError(err, () => finish(main, v, ctx)); }
  store(null);
  const next = r.next;
  let tl = [];
  try { tl = await api.timeline({ sessionId: v.session.id, limit: 60 }); } catch { /* optional */ }
  clear(main).append(h('div', { class: 'stack' },
    h('h1', {}, 'Session complete'),
    h('div', { class: 'card' }, h('h2', {}, `Score: ${r.score}% (${r.correct}/${r.attempts})`),
      r.changes.length ? h('ul', { class: 'list' }, r.changes.map((c) => h('li', {}, h('span', { class: 'jp' }, c.name),
        h('span', { class: 'small muted delta' }, `mastery ${c.before ?? 0} → ${c.after ?? 0}${c.mistakes ? ` · ${c.mistakes} missed` : ''}`)))) : null),
    h('div', { class: 'card hero stack' }, h('h2', {}, 'What the Tutor recommends next'),
      h('p', {}, h('strong', {}, next.recommendation.title), ' — ', h('span', { class: 'jp' }, next.recommendation.focusName)),
      h('p', {}, next.explanation.text), whyBox(next.recommendation, true),
      r.procedural.length ? h('p', { class: 'small muted' }, `Procedural memory updated: ${r.procedural.join(', ')}`) : null,
      h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '#/practice?start=1' }, 'Start the next session'), h('a', { class: 'btn', href: '#/' }, 'Dashboard'))),
    h('div', { class: 'card' }, h('h2', {}, 'Agent handoffs in this session'), timeline(tl)),
    feedbackCard()));
}

export function timeline(events) {
  if (!events.length) return h('div', { class: 'empty' }, 'No agent activity recorded for this session.');
  return h('ol', { class: 'timeline' }, events.map((e) => h('li', { class: e.agent },
    h('div', {}, h('span', { class: `agent ${e.agent}` }, ({ tutor: 'Tutor', examiner: 'Examiner', memory_planner: 'Memory & Planner' })[e.agent] || e.agent), ' · ', h('code', {}, e.action), e.isDemo ? h('span', { class: 'badge demo' }, 'demo') : null),
    kv('Read', e.retrieved), kv('Changed', e.changed), kv('Output', e.output))));
}
const kv = (label, obj) => (obj && Object.keys(obj).length ? h('div', { class: 'kv' }, `${label}: `, h('code', {}, JSON.stringify(obj).slice(0, 420))) : null);

function feedbackCard() {
  const c = h('div', { class: 'card stack' }, h('h2', {}, 'How was the difficulty?'), h('p', { class: 'small muted' }, 'Your answer is stored as explicit procedural memory.'));
  const row = h('div', { class: 'row' });
  for (const [v, l] of [['too_easy', 'Too easy'], ['just_right', 'Just right'], ['too_hard', 'Too hard']]) {
    row.append(h('button', { class: 'btn small', onclick: async (ev) => {
      const btn = ev.currentTarget;
      try { await api.feedback({ type: 'exercise_feedback', verdict: v }); btn.textContent = `${l} ✓`; toast('Feedback saved to procedural memory'); } catch (err) { toast(err.message); }
    } }, l));
  }
  c.append(row);
  return c;
}
