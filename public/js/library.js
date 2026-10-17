import { api } from './api.js';
import { h, clear, plural, statusBadge } from './utils.js';

const TABS = [
  ['all', 'All'], ['vocabulary', 'Vocabulary'], ['kana', 'Hiragana & katakana'], ['kanji', 'Kanji'], ['stroke', 'Stroke order'],
  ['grammar', 'Grammar'], ['reading', 'Reading'], ['listening', 'Listening'], ['exercises', 'Exercises'],
];
const state = { tab: 'all', q: '', topic: '', offset: 0 };
const srcBadge = (origin) => h('span', { class: `badge ${origin === 'original' ? 'src-original' : ''}` }, origin === 'original' ? 'Original content' : origin === 'external' ? 'External (linked)' : 'Local file');

export async function render(main, { showError }) {
  const results = h('div', { id: 'results', 'aria-live': 'polite' });
  const search = h('input', { type: 'search', placeholder: 'Search Japanese, kana, romaji, English, concept…', 'aria-label': 'Search the library', value: state.q });
  const topicSel = h('select', { 'aria-label': 'Filter by topic' }, h('option', { value: '' }, 'All topics'));
  const dialog = h('dialog', { class: 'card detail', 'aria-label': 'Item detail', style: null });
  const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Library sections' });

  const draw = () => {
    clear(tabs).append(...TABS.map(([k, label]) => h('button', { class: 'tab', 'aria-pressed': String(state.tab === k), onclick: () => { state.tab = k; state.offset = 0; draw(); load(); } }, label)));
    toolbar.hidden = !['all', 'vocabulary', 'kana', 'kanji', 'grammar'].includes(state.tab);
  };
  const toolbar = h('div', { class: 'toolbar' }, search, topicSel);
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.q = search.value; state.offset = 0; load(); }, 250); });
  topicSel.addEventListener('change', () => { state.topic = topicSel.value; state.offset = 0; load(); });

  clear(main).append(h('div', { class: 'stack' }, h('h1', {}, 'Learning library'), tabs, toolbar, results, dialog));
  try {
    for (const t of await api.topics()) topicSel.append(h('option', { value: t.name, selected: t.name === state.topic }, `${t.name} (${t.n})`));
  } catch { /* topics are optional */ }
  draw();

  async function load() {
    results.replaceChildren(h('p', { class: 'loading' }, 'Searching…'));
    try {
      if (state.tab === 'stroke') return strokeTab(results, openItem);
      if (state.tab === 'reading') return readingTab(results);
      if (state.tab === 'listening') return results.replaceChildren(h('div', { class: 'card stack' }, h('p', {}, 'Listening lessons live in their own section, with embedded players, notes and comprehension ratings.'), h('a', { class: 'btn primary', href: '#/listening' }, 'Open listening')));
      if (state.tab === 'exercises') return exercisesTab(results);
      const kind = ['vocabulary', 'kana', 'kanji', 'grammar'].includes(state.tab) ? state.tab : '';
      const r = await api.library({ q: state.q, kind, topic: state.topic, limit: 24, offset: state.offset });
      results.replaceChildren(r.items.length ? h('div', { class: 'items' }, r.items.map((it) => itemCard(it, openItem))) : h('div', { class: 'empty' }, state.q ? `No matches for “${state.q}”. Try kana, romaji or an English meaning.` : 'Nothing here yet — run `npm run ingest`.'),
        h('div', { class: 'row' },
          state.offset ? h('button', { class: 'btn small', onclick: () => { state.offset = Math.max(0, state.offset - 24); load(); } }, '← Previous') : null,
          r.hasMore ? h('button', { class: 'btn small', onclick: () => { state.offset += 24; load(); } }, 'More →') : null));
    } catch (err) { showError(err, load); }
  }

  async function openItem(id) {
    try {
      const it = await api.libraryItem(id);
      detail(dialog, it, openItem);
      if (!dialog.open) dialog.showModal();
    } catch (err) { results.prepend(h('div', { class: 'error-box', role: 'alert' }, err.message)); }
  }
  load();
}

function itemCard(it, open) {
  const title = it.word || it.char || it.name;
  const sub = it.kind === 'grammar' ? it.pattern : it.kind === 'kana' ? `${it.romaji} · ${it.script}` : `${it.reading && it.reading !== title ? `${it.reading} · ` : ''}${it.meaning || ''}`;
  return h('button', { class: 'item', onclick: () => open(it.id), 'aria-label': `${title}, ${sub}` },
    h('span', { class: 'big', lang: 'ja' }, it.kind === 'grammar' ? it.name.split(' ')[0] : title),
    h('span', { class: 'small', lang: 'ja' }, sub), h('span', { class: 'badge' }, it.kind));
}

function detail(dlg, it, open) {
  const title = it.word || it.char || it.name;
  const dl = h('dl', {});
  const row = (k, v) => v ? dl.append(h('dt', {}, k), h('dd', { lang: 'ja' }, v)) : null;
  if (it.kind === 'vocabulary') { row('Reading', it.reading); row('Romaji', it.romaji); row('Meaning', it.meaning); row('Part of speech', it.pos); row('Level', it.level === 'unknown' ? 'not labelled' : it.level); }
  if (it.kind === 'kanji') { row('Meaning', it.meaning); row('On-yomi', it.onyomi); row('Kun-yomi', it.kunyomi); row('Strokes', it.strokes > 0 ? String(it.strokes) : ''); }
  if (it.kind === 'kana') { row('Romaji', it.romaji); row('Script', it.script); }
  if (it.kind === 'grammar') { row('Pattern', it.pattern); row('Explanation', it.explanation); }
  const refs = it.resources.filter((r) => r.rel === 'REFERENCES');
  const counts = it.exercises.reduce((m, e) => { (m[`${e.type}|${e.origin}`] ??= { ...e, n: 0 }).n++; return m; }, {});
  clear(dlg).append(h('div', { class: 'stack' },
    h('div', { class: 'row' }, h('h2', { lang: 'ja', class: 'jp' }, it.kind === 'kanji' ? '' : title), h('form', { method: 'dialog', class: 'row' }, h('button', { class: 'btn small' }, 'Close'))),
    it.kind === 'kanji' ? h('div', { class: 'glyph', lang: 'ja' }, it.char) : null,
    dl,
    it.example ? h('div', { class: 'card flat' }, h('div', { class: 'jp', lang: 'ja' }, it.example), it.exampleReading ? h('div', { class: 'small muted', lang: 'ja' }, it.exampleReading) : null, h('div', {}, it.exampleMeaning)) : null,
    it.kind === 'kanji' ? h('div', { class: 'card flat' }, refs.length
      ? [h('strong', {}, 'Stroke-order reference material'), h('ul', { class: 'list' }, refs.map((r) => h('li', {}, `${r.title}${r.page ? ` · page ${r.page}` : ''}`, h('span', { class: 'small muted' }, `${r.source}`))))]
      : h('p', { class: 'small' }, 'No stroke-order reference is installed for this kanji. Only the stroke count above is available (from the source CSV). Drop a stroke-order PDF or image into resources/local/ and run npm run ingest to link it here.')) : null,
    it.topics.length ? h('div', { class: 'chips' }, it.topics.map((t) => h('span', { class: 'badge' }, t))) : null,
    it.learnerState ? h('p', { class: 'small' }, 'Your memory: ', statusBadge(it.learnerState.status), ` mastery ${it.learnerState.mastery} · ${plural(it.learnerState.attempts, 'attempt')}`) : h('p', { class: 'small muted' }, 'Not practised yet by this learner.'),
    it.related.length ? h('div', {}, h('strong', {}, 'Related in the graph'), h('div', { class: 'chips' }, it.related.map((r) => h('button', { class: 'btn small', onclick: () => open(r.id) }, `${r.rel === 'APPEARS_IN' ? (r.outgoing ? 'appears in' : 'contains') : r.rel.toLowerCase().replace('_', ' ')}: ${r.name}`)))) : null,
    it.exercises.length ? h('div', {}, h('strong', {}, `${plural(it.exercises.length, 'exercise')} available`), h('div', { class: 'chips' }, Object.values(counts).map((c) => h('span', { class: `badge ${c.origin === 'original' ? 'src-original' : ''}` }, `${c.type} ×${c.n} · ${c.origin === 'original' ? 'original' : 'generated from source'}`)))) : null,
    h('div', { class: 'small muted' }, 'Sources: ', it.resources.filter((r) => r.rel !== 'REFERENCES').map((r) => `${r.title}${r.loc ? ` (${r.loc})` : ''} — ${r.source}; ${r.license}`).join(' | ') || 'n/a')));
}

async function strokeTab(el, open) {
  const [refs, kanji] = await Promise.all([api.kanjiRefs(), api.library({ kind: 'kanji', limit: 60 })]);
  el.replaceChildren(h('div', { class: 'stack' },
    h('div', { class: 'card flat' }, h('strong', {}, 'Stroke-order reference'),
      refs.length ? h('p', {}, `${plural(refs.length, 'kanji↔page link')} found in local reference files (linked by text/filename match; stroke data itself is not parsed).`)
        : h('p', {}, 'No stroke-order PDFs or images are installed, so this app shows stroke counts only and does not claim to animate or verify stroke order. Add files under resources/local/ (for example 日.png or a stroke-order PDF) and run npm run ingest.')),
    h('div', { class: 'items' }, kanji.items.map((k) => { const n = refs.filter((r) => r.kanji === k.id); return h('button', { class: 'item', onclick: () => open(k.id) }, h('span', { class: 'big', lang: 'ja' }, k.char), h('span', { class: 'small' }, `${k.strokes > 0 ? `${k.strokes} strokes` : 'stroke count unknown'}${n.length ? ` · ${n.length} reference(s)` : ''}`)); }))));
}

function readingTab(el) {
  el.replaceChildren(h('div', { class: 'card stack' }, h('h2', {}, 'Reading'),
    h('p', {}, 'No reading passages are bundled with this app. Example sentences for every vocabulary and grammar item are in the library.'),
    h('p', {}, 'Lazy Benkyou publishes a separate Story Reader with beginner stories (tap-to-view readings and synced audio). It is their product, so it is linked rather than copied:'),
    h('a', { class: 'btn primary', href: 'https://read.lazybenkyou.com', target: '_blank', rel: 'noopener noreferrer' }, 'Open Lazy Benkyou Story Reader ↗')));
}

async function exercisesTab(el) {
  const rows = await api.exerciseSummary();
  const label = { original: 'Original (authored for this project)', 'generated-from-source': 'Generated mechanically from source data' };
  const groups = rows.reduce((m, r) => { (m[r.origin] ??= []).push(r); return m; }, {});
  el.replaceChildren(h('div', { class: 'stack' }, Object.entries(groups).map(([origin, list]) => h('div', { class: 'card' },
    h('h2', {}, label[origin] || origin), h('ul', { class: 'list' }, list.map((r) => h('li', {}, h('span', {}, r.type), h('span', { class: 'small muted' }, `${r.format} · ${r.n}`))))))
    .concat(h('p', { class: 'small muted' }, 'Start a practice session to answer these; the Examiner chooses based on your memory.'))));
}
