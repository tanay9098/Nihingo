import { api, isDemoView } from './api.js';
import { h, clear, ago, plural, toast, demoBadge, statusBadge } from './utils.js';
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
  const tl = h('div', { class: 'card' }, h('h2', {}, 'Agent activity (from the graph)'),
    h('p', { class: 'small muted' }, 'Every row is an AgentEvent node in FalkorDB, linked by HANDED_OFF_TO — what each agent read, what it changed, and what it produced. Newest first.'),
    timeline(events));

  // --- three memories
  const episodic = h('div', { class: 'card stack' }, h('h2', {}, 'Episodic memory'), h('p', { class: 'small muted' }, mem.episodic.note),
    h('p', {}, `${plural(mem.episodic.sessions.length, 'recent session')}, ${plural(mem.episodic.mistakes.length, 'recent mistake')}, ${plural(mem.episodic.listening.length, 'listening log')}.`),
    mem.episodic.mistakes.slice(0, 5).map((m) => h('div', { class: 'small', lang: 'ja' }, `${m.concept}: “${m.given}” instead of “${m.expected}” `, demoBadge(m.isDemo), ` ${ago(m.at)}`)));
  const semantic = h('div', { class: 'card stack' }, h('h2', {}, 'Semantic memory'), h('p', { class: 'small muted' }, mem.semantic.note),
    mem.semantic.concepts.length ? h('ul', { class: 'list' }, mem.semantic.concepts.slice(0, 8).map((c) => h('li', {}, h('span', { class: 'jp' }, c.name), h('span', { class: 'small muted' }, statusBadge(c.status), ` mastery ${c.mastery} · ${plural(c.attempts, 'attempt')}`))))
      : h('div', { class: 'empty' }, 'No concepts studied yet.'));
  const procedural = h('div', { class: 'card stack' }, h('h2', {}, 'Procedural memory'), h('p', { class: 'small muted' }, mem.procedural.note),
    h('p', {}, `Format in use: ${eff.format ? `${eff.format} (${eff.formatSource})` : 'none yet'} · ${eff.session_length} questions · revision pace ${eff.revision_pace}.`),
    mem.procedural.preferences.length ? h('ul', { class: 'list' }, mem.procedural.preferences.map((p) => h('li', {}, h('span', {}, h('code', {}, p.key), ` = ${p.value}`, h('div', { class: 'small muted' }, p.evidence)), h('span', { class: `badge ${p.source === 'explicit' ? 'ok' : 'warn'}` }, p.source))))
      : h('div', { class: 'empty' }, 'Nothing learned about study habits yet.'));

  // --- preferences form
  const form = h('div', { class: 'card stack' }, h('h2', {}, 'Correct my preferences'),
    h('p', { class: 'small muted' }, 'Explicit settings override anything the system inferred, and change the next session right away.'),
    h('div', { class: 'pref-form' }, Object.entries(PREFS).map(([key, [label, opts]]) => {
      const current = byKey[key]?.value ?? String(eff[key] ?? opts[0][0]);
      const sel = h('select', { id: `pref-${key}` }, opts.map(([v, l]) => h('option', { value: v, selected: v === current }, l)));
      sel.addEventListener('change', async () => {
        try { await api.feedback({ type: 'preference', key, value: sel.value }); toast('Preference saved to procedural memory'); rerender(); } catch (err) { toast(err.message); }
      });
      return h('label', { for: `pref-${key}` }, label, sel);
    })),
    byKey.inferred_format ? h('div', { class: 'row' }, h('span', { class: 'small' }, `Inferred: you do best with “${byKey.inferred_format.value}” (${byKey.inferred_format.evidence}).`),
      h('button', { class: 'btn small', onclick: async () => { await api.feedback({ type: 'clear_preference', key: 'inferred_format' }); toast('Inferred preference removed'); rerender(); } }, 'That’s wrong — remove')) : null);

  // --- graph explorer
  const center = qs.get('center') || mem.learner.id;
  const gbox = h('div', { class: 'graph-wrap' }, h('p', { class: 'loading' }, 'Loading graph…'));
  const depthSel = h('select', { 'aria-label': 'Depth' }, [['1', '1 hop'], ['2', '2 hops']].map(([v, l]) => h('option', { value: v }, l)));
  const label = h('span', { class: 'small muted' });
  const loadGraph = async (id) => {
    try {
      const { renderGraph } = await import('./graph.js');
      const data = await api.neighborhood({ center: id, depth: depthSel.value, limit: 50 });
      label.textContent = `Centre: ${data.nodes.find((n) => n.center)?.label} · ${data.nodes.length} nodes · ${data.edges.length} edges`;
      renderGraph(gbox, data, { onSelect: loadGraph, caption: 'Graph explorer' });
    } catch (err) { gbox.replaceChildren(h('p', { class: 'muted', style: null }, `Graph unavailable: ${err.message}`)); }
  };
  depthSel.addEventListener('change', () => loadGraph(center));
  const explorer = h('div', { class: 'card stack' }, h('h2', {}, 'Graph explorer'),
    h('p', { class: 'small muted' }, 'A bounded neighbourhood of the FalkorDB knowledge graph. Click any node to re-centre.'),
    h('div', { class: 'row' }, depthSel, h('button', { class: 'btn small', onclick: () => loadGraph(mem.learner.id) }, 'Back to learner'), label), gbox);

  // --- ask the tutor
  const ask = h('div', { class: 'card stack' }, h('h2', {}, 'Ask the Tutor (source-grounded)'),
    h('p', { class: 'small muted' }, 'Answers come from graph retrieval over the indexed library; if nothing matches, it says so instead of guessing.'));
  const q = h('input', { type: 'text', placeholder: 'e.g. difference between に and で', 'aria-label': 'Question', maxlength: 200 });
  const out = h('div', { 'aria-live': 'polite' });
  const go = async () => {
    if (!q.value.trim()) return;
    out.replaceChildren(h('p', { class: 'loading' }, 'Retrieving from the graph…'));
    try {
      const r = await api.ask(q.value.trim());
      out.replaceChildren(h('div', { class: 'card flat stack' }, h('p', {}, r.answer), h('p', { class: 'small muted' }, `Engine: ${r.engine} · ${plural(r.retrieved, 'passage')} retrieved`),
        r.passages.map((p) => h('details', { class: 'why' }, h('summary', { lang: 'ja' }, p.text.slice(0, 70)), h('p', { lang: 'ja' }, p.text), h('p', { class: 'small muted' }, p.sources.map((s) => `${s.title} (${s.source})`).join('; ')),
          p.related.length ? h('p', { class: 'small muted' }, `Graph neighbours: ${p.related.map((x) => `${x.rel} ${x.name}`).join(', ')}`) : null))));
    } catch (err) { out.replaceChildren(h('div', { class: 'error-box', role: 'alert' }, err.message)); }
  };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  ask.append(h('div', { class: 'answer-row' }, q, h('button', { class: 'btn primary', onclick: go }, 'Ask')), out);

  // --- reset
  const isDemo = isDemoView();
  const reset = h('div', { class: 'card stack' }, h('h2', {}, isDemo ? 'Reset the demo' : 'Reset my progress'),
    h('p', { class: 'small muted' }, isDemo ? 'Deletes the live activity recorded for the demo learner and restores the seeded demo history, so the two-session demo can be repeated.' : 'Permanently deletes all sessions, attempts, mistakes, mastery estimates, preferences and agent history for your learning path. Your account stays.'),
    h('button', { class: 'btn danger', onclick: async (e) => {
      if (!confirm(isDemo ? 'Restore the demo learner to its seeded state?' : 'Delete all of your learning progress? This cannot be undone.')) return;
      const b = e.currentTarget; b.disabled = true;
      try { await api.reset(); try { sessionStorage.removeItem('session'); } catch { /* ignore */ } toast('Progress reset'); rerender(); } catch (err) { b.disabled = false; toast(err.message); }
    } }, isDemo ? 'Restore seeded demo' : 'Delete my progress'));

  clear(main).append(h('div', { class: 'stack' }, h('h1', {}, 'Learner memory & agents'),
    h('div', { class: 'grid three' }, episodic, semantic, procedural), tl, explorer, form, ask, reset));
  loadGraph(center);
}
