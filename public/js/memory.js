import { api, isDemoView } from './api.js';
import { h, clear, ago, plural, pct, toast, demoBadge, statusBadge, prefText, FORMAT_LABEL } from './utils.js';
import { timeline } from './learning.js';

const PREFS = {
  session_length: ['Questions per session', [['3', '3 (short)'], ['5', '5 (default)'], ['8', '8 (long)']]],
  preferred_format: ['Preferred exercise format', [['any', 'No preference'], ['multiple_choice', 'Multiple choice'], ['typed', 'Typed answers'], ['flashcard', 'Flashcards']]],
  include_listening: ['Recommend listening practice', [['true', 'Yes'], ['false', 'No']]],
  revision_pace: ['Revision pace', [['fast', 'Faster (shorter gaps)'], ['normal', 'Normal'], ['slow', 'Slower (longer gaps)']]],
};

export async function render(main, { showError, rerender }) {
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  let mem, events;
  try { [mem, events] = await Promise.all([api.memory(), api.timeline({ limit: 60 })]); } catch (err) { return showError(err, () => render(main, { showError, rerender })); }

  const eff = mem.procedural.effective;
  const byKey = Object.fromEntries(mem.procedural.preferences.map((p) => [p.key, p]));

  // --- agent timeline
  const tl = h('div', { class: 'card' }, h('h2', {}, 'What the app did for you'),
    h('p', { class: 'small muted' }, 'Each step your tutor took to plan, quiz and track your progress. Newest first.'),
    timeline(events, Object.fromEntries([...mem.episodic.mistakes.map((m) => [m.conceptId, m.concept]), ...mem.semantic.concepts.map((c) => [c.id, c.name])])));

  // --- three memories (episodic / semantic / procedural), worded for learners
  const ep = mem.episodic;
  const episodic = h('div', { class: 'card stack' }, h('h2', {}, 'My study history'), h('p', { class: 'small muted' }, 'Your recent sessions, mistakes and listening practice.'),
    ep.sessions.length || ep.listening.length
      ? h('p', {}, `${plural(ep.sessions.length, 'recent session')}, ${plural(ep.mistakes.length, 'recent mistake')}, ${plural(ep.listening.length, 'listening lesson')} rated.`)
      : h('div', { class: 'empty' }, 'No sessions yet. Start one from Today.'),
    ep.mistakes.slice(0, 5).map((m) => h('div', { class: 'small', lang: 'ja' }, `${m.concept}: you wrote “${m.given}”, the answer was “${m.expected}” `, demoBadge(m.isDemo), ` · ${ago(m.at)}`)));
  const semantic = h('div', { class: 'card stack' }, h('h2', {}, 'What I’ve learned'), h('p', { class: 'small muted' }, 'Items you’ve practised and how well you know them. These are cautious estimates.'),
    mem.semantic.concepts.length ? h('ul', { class: 'list' }, mem.semantic.concepts.slice(0, 8).map((c) => h('li', {}, h('span', { class: 'jp' }, c.name), h('span', { class: 'small muted' }, statusBadge(c.status), ` ${pct(c.mastery)} known · practised ${c.attempts === 1 ? 'once' : `${c.attempts} times`}`))))
      : h('div', { class: 'empty' }, 'Nothing practised yet. Start a session from Today.'));
  const style = eff.format ? `${FORMAT_LABEL[eff.format] || eff.format}${eff.formatSource === 'explicit' ? ' (your choice)' : ' (we noticed this suits you)'}` : 'not decided yet';
  const procedural = h('div', { class: 'card stack' }, h('h2', {}, 'How I learn best'), h('p', { class: 'small muted' }, 'Your study settings, plus habits we’ve noticed from your answers.'),
    h('p', {}, `Question style: ${style} · ${eff.session_length} questions per session · ${{ fast: 'faster', normal: 'normal', slow: 'slower' }[eff.revision_pace] || eff.revision_pace} revision pace.`),
    mem.procedural.preferences.length ? h('ul', { class: 'list' }, mem.procedural.preferences.map((p) => {
      const [label, value] = prefText(p.key, p.value);
      return h('li', {}, h('span', {}, `${label}: ${value}`, h('div', { class: 'small muted' }, p.evidence)), h('span', { class: `badge ${p.source === 'explicit' ? 'ok' : 'warn'}` }, p.source === 'explicit' ? 'You chose' : 'We noticed'));
    }))
      : h('div', { class: 'empty' }, 'We’ll learn your study habits after a few sessions.'));

  // --- preferences form
  const form = h('div', { class: 'card stack' }, h('h2', {}, 'Correct my preferences'),
    h('p', { class: 'small muted' }, 'Explicit settings override anything the system inferred, and change the next session right away.'),
    h('div', { class: 'pref-form' }, Object.entries(PREFS).map(([key, [label, opts]]) => {
      const current = byKey[key]?.value ?? String(eff[key] ?? opts[0][0]);
      const sel = h('select', { id: `pref-${key}` }, opts.map(([v, l]) => h('option', { value: v, selected: v === current }, l)));
      sel.addEventListener('change', async () => {
        try { await api.feedback({ type: 'preference', key, value: sel.value }); toast('Saved. Your next session will use this'); rerender(); } catch (err) { toast(err.message); }
      });
      return h('label', { for: `pref-${key}` }, label, sel);
    })),
    byKey.inferred_format ? h('div', { class: 'row' }, h('span', { class: 'small' }, `We noticed you do best with ${FORMAT_LABEL[byKey.inferred_format.value] || byKey.inferred_format.value} (${byKey.inferred_format.evidence}).`),
      h('button', { class: 'btn small', onclick: async () => { await api.feedback({ type: 'clear_preference', key: 'inferred_format' }); toast('Got it, we removed that'); rerender(); } }, 'That’s wrong — remove')) : null);

  // --- graph explorer
  const center = qs.get('center') || mem.learner.id;
  const gbox = h('div', { class: 'graph-wrap' }, h('p', { class: 'loading' }, 'Loading map…'));
  const depthSel = h('select', { 'aria-label': 'How much to show' }, [['1', 'Closest items only'], ['2', 'Show more connections']].map(([v, l]) => h('option', { value: v }, l)));
  const sourcesBox = h('input', { type: 'checkbox', id: 'map-sources' });
  const label = h('span', { class: 'small muted' });
  const loadGraph = async (id) => {
    try {
      const { renderGraph } = await import('./graph.js');
      const data = await api.neighborhood({ center: id, depth: depthSel.value, limit: 50, sources: sourcesBox.checked ? '1' : '0' });
      label.textContent = `Centred on ${data.nodes.find((n) => n.center)?.label} · ${plural(Math.max(0, data.nodes.length - 1), 'linked item')}`;
      renderGraph(gbox, data, { onSelect: loadGraph, caption: 'My learning map' });
    } catch (err) { gbox.replaceChildren(h('p', { class: 'muted', style: null }, `The map couldn’t be loaded: ${err.message}`)); }
  };
  depthSel.addEventListener('change', () => loadGraph(center));
  sourcesBox.addEventListener('change', () => loadGraph(center));
  const explorer = h('div', { class: 'card stack' }, h('h2', {}, 'My learning map'),
    h('p', { class: 'small muted' }, 'How your practice connects to what you’re learning. Click any item to see what it links to.'),
    h('div', { class: 'row' }, depthSel, h('label', { class: 'check small', for: 'map-sources' }, sourcesBox, 'Show lesson sources'),
      h('button', { class: 'btn small', onclick: () => loadGraph(mem.learner.id) }, 'Back to me'), label), gbox);

  // --- ask the tutor
  const ask = h('div', { class: 'card stack' }, h('h2', {}, 'Ask the tutor'),
    h('p', { class: 'small muted' }, 'Answers come only from the lessons in the library. If nothing matches, the tutor says so instead of guessing.'));
  const q = h('input', { type: 'text', placeholder: 'e.g. difference between に and で', 'aria-label': 'Question', maxlength: 200 });
  const out = h('div', { 'aria-live': 'polite' });
  const go = async () => {
    if (!q.value.trim()) return;
    out.replaceChildren(h('p', { class: 'loading' }, 'Looking it up…'));
    try {
      const r = await api.ask(q.value.trim());
      out.replaceChildren(h('div', { class: 'card flat stack' }, h('p', {}, r.answer), h('p', { class: 'small muted' }, `Based on ${plural(r.retrieved, 'passage')} from the library`),
        r.passages.map((p) => h('details', { class: 'why' }, h('summary', { lang: 'ja' }, p.text.slice(0, 70)), h('p', { lang: 'ja' }, p.text), h('p', { class: 'small muted' }, p.sources.map((s) => `${s.title} (${s.source})`).join('; ')),
          p.related.length ? h('p', { class: 'small muted' }, `Related: ${p.related.map((x) => x.name).join(', ')}`) : null))));
    } catch (err) { out.replaceChildren(h('div', { class: 'error-box', role: 'alert' }, err.message)); }
  };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  ask.append(h('div', { class: 'answer-row' }, q, h('button', { class: 'btn primary', onclick: go }, 'Ask')), out);

  // --- reset
  const isDemo = isDemoView();
  const reset = h('div', { class: 'card stack' }, h('h2', {}, isDemo ? 'Reset the demo' : 'Reset my progress'),
    h('p', { class: 'small muted' }, isDemo ? 'Deletes the live activity recorded for the demo learner and restores the seeded demo history, so the two-session demo can be repeated.' : 'Permanently deletes all sessions, answers, mistakes, progress estimates, preferences and activity history for your learning path. Your account stays.'),
    h('button', { class: 'btn danger', onclick: async (e) => {
      if (!confirm(isDemo ? 'Restore the demo learner to its seeded state?' : 'Delete all of your learning progress? This cannot be undone.')) return;
      const b = e.currentTarget; b.disabled = true;
      try { await api.reset(); try { sessionStorage.removeItem('session'); } catch { /* ignore */ } toast('Progress reset'); rerender(); } catch (err) { b.disabled = false; toast(err.message); }
    } }, isDemo ? 'Restore seeded demo' : 'Delete my progress'));

  clear(main).append(h('div', { class: 'stack' }, h('h1', {}, 'My progress'),
    h('div', { class: 'grid three' }, episodic, semantic, procedural), tl, explorer, form, ask, reset));
  loadGraph(center);
}
