import { api } from './api.js';
import { h, clear, ago, plural, pct, demoBadge, statusBadge, whyBox } from './utils.js';

const KIND_LABEL = { vocabulary: 'Vocabulary', kanji: 'Kanji', kana: 'Kana', grammar: 'Grammar' };

export async function render(main, { showError }) {
  let d;
  try { d = await api.dashboard(); } catch (err) { return showError(err, () => render(main, { showError })); }
  const rec = d.plan.recommendation;
  const first = d.plan.lesson.concepts[0];

  const hero = h('section', { class: 'card hero stack', 'aria-labelledby': 'plan-h' },
    h('div', { class: 'row' }, h('h1', { id: 'plan-h' }, 'Today’s plan'), h('span', { class: 'badge' }, rec.title)),
    h('p', { class: 'jp' }, h('strong', {}, rec.focusName)),
    h('p', {}, d.plan.explanation.text),
    d.plan.explanation.by.startsWith('LLM') ? h('p', { class: 'small muted' }, 'Written with AI help, using only the facts below.') : null,
    whyBox(rec),
    first ? h('details', { class: 'why' }, h('summary', {}, 'Quick refresher on the focus'),
      d.plan.lesson.concepts.map((c) => h('div', { class: 'stack' },
        h('p', {}, h('strong', { class: 'jp' }, c.name), c.pattern ? ` — ${c.pattern}` : ''),
        c.explanation ? h('p', {}, c.explanation) : c.meaning ? h('p', {}, `${c.reading ? `${c.reading} · ` : ''}${c.meaning}`) : c.romaji ? h('p', {}, `${c.script ? `${c.script} · ` : ''}“${c.romaji}”`) : null,
        c.example ? h('p', { class: 'jp' }, c.example, h('span', { class: 'muted' }, ` ${c.exampleMeaning || ''}`)) : null))) : null,
    h('div', { class: 'row' },
      h('a', { class: 'btn primary', href: '#/practice?start=1' }, 'Start today’s session'),
      h('a', { class: 'btn', href: '#/memory' }, 'See what the app did')));

  const pathCard = learningPath(d.pathway, rec.evidence?.rule === 'first-session');

  const listen = d.listening;
  const listenCard = listen ? h('section', { class: 'card stack', 'aria-labelledby': 'listen-h' },
    h('h2', { id: 'listen-h' }, 'Listening recommendation'),
    h('p', {}, h('strong', {}, listen.focusName)),
    h('p', { class: 'muted' }, listen.reason),
    whyBox(listen),
    h('a', { class: 'btn', href: '#/listening' }, 'Open listening library')) : null;

  const progress = h('section', { class: 'card stack', 'aria-labelledby': 'prog-h' }, h('h2', { id: 'prog-h' }, 'Progress'),
    Object.entries(d.progress).map(([k, p]) => h('div', { class: 'stat' },
      h('div', { class: 'row' }, h('b', {}, KIND_LABEL[k]), h('span', { class: 'muted small' }, `${p.studied}/${p.total} studied · ${p.mastered} mastered`, p.struggling ? ` · ${p.struggling} struggling` : '')),
      h('div', { class: 'bar', role: 'progressbar', 'aria-label': `${KIND_LABEL[k]} studied`, 'aria-valuenow': p.studied, 'aria-valuemin': 0, 'aria-valuemax': p.total, vars: { '--v': p.total ? (100 * p.studied) / p.total : 0 } }, h('span')))),
    h('p', { class: 'small muted' }, 'Mastery is a conservative estimate (Wilson lower bound) — a few lucky answers do not count as mastered.'));

  const sessions = h('section', { class: 'card', 'aria-labelledby': 'sess-h' }, h('h2', { id: 'sess-h' }, 'Recent activity'),
    d.recentSessions.length ? h('ul', { class: 'list' }, d.recentSessions.map((s) => h('li', {},
      h('span', {}, h('strong', {}, s.attempts ? `${s.correct}/${s.attempts} correct` : 'No answers yet'), ' ', demoBadge(s.isDemo), h('br'), h('span', { class: 'small muted' }, `${ago(s.startedAt)}${s.focus ? ` · focus: ${s.focus}` : ''}`)),
      h('span', { class: 'badge' }, s.status))))
      : h('div', { class: 'empty' }, 'No sessions yet. Start one and the app will begin remembering your progress.'));

  const mistakes = h('section', { class: 'card', 'aria-labelledby': 'mist-h' }, h('h2', { id: 'mist-h' }, 'Recently missed'),
    d.recentMistakes.length ? h('ul', { class: 'list' }, d.recentMistakes.map((m) => h('li', {},
      h('span', {}, h('strong', { class: 'jp' }, m.concept), ' ', demoBadge(m.isDemo), h('br'), h('span', { class: 'small muted jp' }, `${m.prompt || ''} → you: “${m.given}” · expected: “${m.expected}”`)),
      h('span', { class: 'small muted' }, ago(m.at)))))
      : h('div', { class: 'empty' }, 'No mistakes recorded — nothing to revise yet.'));

  const gramRev = h('section', { class: 'card', 'aria-labelledby': 'gram-h' }, h('h2', { id: 'gram-h' }, 'Grammar needing revision'),
    d.grammarToRevise.length ? h('ul', { class: 'list' }, d.grammarToRevise.map((g) => h('li', {},
      h('span', {}, h('strong', { class: 'jp' }, g.name), h('br'), h('span', { class: 'small muted' }, `${plural(g.mistakes, 'mistake')} in ${plural(g.sessions, 'session')}${g.demoMistakes ? ` (${g.demoMistakes} demo)` : ''}`)),
      statusBadge(g.status))))
      : h('div', { class: 'empty' }, 'No grammar concepts flagged.'));

  const due = h('section', { class: 'card', 'aria-labelledby': 'due-h' }, h('h2', { id: 'due-h' }, 'Due for review'),
    d.due.length ? h('ul', { class: 'list' }, d.due.slice(0, 6).map((x) => h('li', {}, h('span', { class: 'jp' }, x.name), h('span', { class: 'small muted' }, `${x.kind} · ${pct(x.mastery)} known`))))
      : h('div', { class: 'empty' }, 'Nothing overdue.'));

  const mem = h('section', { class: 'card', 'aria-labelledby': 'mem-h' }, h('h2', { id: 'mem-h' }, 'My learning map'),
    h('p', { class: 'small muted' }, 'What you’ve practised so far. Line colour shows how well you know each item. Click an item to explore.'),
    h('div', { id: 'mini-graph' }, h('p', { class: 'loading' }, 'Loading map…')));

  clear(main).append(h('div', { class: 'stack' },
    hero, pathCard, h('div', { class: 'grid main-side' }, h('div', { class: 'stack' }, sessions, mistakes, gramRev), h('div', { class: 'stack' }, progress, listenCard, due)), mem));

  // The graph is optional: failure here must not break the dashboard.
  const box = main.querySelector('#mini-graph');
  try {
    const { renderGraph } = await import('./graph.js');
    const data = await api.neighborhood({ center: d.learner.id, depth: 1, limit: 28, sources: '0' });
    renderGraph(box, data, { caption: 'My learning map', onSelect: (id) => { location.hash = `#/memory?center=${encodeURIComponent(id)}`; } });
  } catch (err) {
    clear(box).append(h('p', { class: 'muted' }, `The map couldn’t be loaded (${err.message}). The rest of the page still works.`));
  }
}

const STEP_STATUS = { completed: ['Completed', 'ok'], current: ['You are here', 'warn'], upcoming: ['Upcoming', ''] };

/** The beginner learning path: ordered steps, where the learner is, what comes before/after, and how to revisit. */
function learningPath(path, isNew) {
  if (!path?.steps.length) return null;
  const libraryHref = (s) => `#/library?tab=${s.libraryTab}${s.libraryTopic ? `&topic=${encodeURIComponent(s.libraryTopic)}` : ''}`;
  return h('section', { class: 'card stack', 'aria-labelledby': 'path-h' },
    h('div', { class: 'row' }, h('h2', { id: 'path-h' }, 'Your learning path'),
      h('span', { class: 'small muted' }, `${path.completed}/${path.totalSteps} steps completed`)),
    isNew ? h('div', { class: 'card flat stack' }, h('strong', {}, 'New to Japanese? Start here.'),
      h('p', { class: 'small' }, 'Work through the steps below in order, starting with step 1. Press “Start today’s session” for about five questions; your progress is saved, so next time you continue where you left off. Anything you have studied can be looked up again in the Library.')) : null,
    h('p', { class: 'small muted' }, 'A step is completed once you have practised every item in it. When something is due for review or keeps being missed, sessions revise it before introducing new items.'),
    h('ol', { class: 'path' }, path.steps.map((s) => {
      const [label, cls] = STEP_STATUS[s.status];
      const cur = s.status === 'current';
      return h('li', { class: `path-step ${s.status}`, 'aria-current': cur ? 'step' : null },
        h('div', { class: 'row' }, h('strong', {}, `${s.step}. ${s.title}`), h('span', { class: 'small muted' }, s.module), h('span', { class: `badge ${cls}` }, label)),
        cur ? h('p', { class: 'small' }, s.purpose) : null,
        h('p', { class: 'small muted' }, s.requires.length ? `Builds on: ${s.requires.map((r) => r.title).join(', ')}` : 'No prerequisites: the starting point.',
          s.preview.length ? [' · Includes ', h('span', { class: 'jp' }, `${s.preview.join('、')}…`)] : null),
        h('div', { class: 'bar', role: 'progressbar', 'aria-label': `${s.title} practised`, 'aria-valuenow': s.studied, 'aria-valuemin': 0, 'aria-valuemax': s.total, vars: { '--v': (100 * s.studied) / s.total } }, h('span')),
        h('div', { class: 'row' }, h('span', { class: 'small muted' }, `${s.studied}/${s.total} practised · ${s.mastered} mastered`),
          cur ? h('a', { class: 'btn small primary', href: '#/practice?start=1' }, 'Continue this step') : null,
          s.studied ? h('a', { class: 'btn small', href: libraryHref(s) }, s.status === 'completed' ? 'Revisit' : 'Review in Library') : null));
    })));
}
