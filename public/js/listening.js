import { api } from './api.js';
import { h, clear, uuid, ago, toast, demoBadge, whyBox } from './utils.js';

export async function render(main, { showError }) {
  let data;
  try { data = await api.listening(); } catch (err) { return showError(err, () => render(main, { showError })); }
  let rec = null;
  try { rec = (await api.recommendations()).listening; } catch { /* optional */ }
  const dialog = h('dialog', { class: 'card detail', 'aria-label': 'Lesson player' });
  const lessons = data.lessons;
  const s = data.source;

  const header = h('div', { class: 'card stack' },
    h('h1', {}, 'Listening practice'),
    h('p', {}, 'Native-speed beginner listening from ', h('a', { href: s.website, target: '_blank', rel: 'noopener noreferrer' }, 'Lazy Benkyou'),
      '. Videos play through YouTube’s official embed and are never downloaded or re-hosted. Titles, ids and dates were read from the channel’s public feed.'),
    h('div', { class: 'row' },
      h('a', { class: 'btn small', href: s.start, target: '_blank', rel: 'noopener noreferrer' }, 'Start here ↗'),
      h('a', { class: 'btn small', href: s.youtube, target: '_blank', rel: 'noopener noreferrer' }, 'YouTube channel ↗'),
      h('a', { class: 'btn small', href: 'https://read.lazybenkyou.com', target: '_blank', rel: 'noopener noreferrer' }, 'Story Reader ↗')),
    h('p', { class: 'small muted' }, 'Levels are shown only when the video title states one (these titles say “JLPT N5”); otherwise the level is “unknown”. No transcripts are bundled, so transcript practice is unavailable until a legitimate transcript is added to a catalog entry.'));

  const recCard = rec ? h('div', { class: 'card hero stack' }, h('h2', {}, 'Recommended for you'), h('p', {}, h('strong', {}, rec.focusName)), h('p', { class: 'muted' }, rec.reason), whyBox(rec),
    h('button', { class: 'btn primary', onclick: () => openPlayer(lessons.find((l) => l.id === rec.focusId)) }, 'Watch now')) : null;

  const grid = h('div', { class: 'videos' }, lessons.length ? lessons.map(card) : h('div', { class: 'empty' }, 'No listening lessons are indexed. Run npm run ingest.'));
  const logs = h('div', { class: 'card' }, h('h2', {}, 'Your listening history'),
    data.logs.length ? h('ul', { class: 'list' }, data.logs.map((l) => h('li', {}, h('span', {}, h('strong', {}, l.title), ' ', demoBadge(l.isDemo), l.note ? h('div', { class: 'small muted' }, l.note) : null), h('span', { class: 'small muted' }, `${'★'.repeat(l.rating)}${'☆'.repeat(5 - l.rating)} · ${ago(l.at)}`))))
      : h('div', { class: 'empty' }, 'No listening logged yet. After watching, rate how much you understood.'));

  clear(main).append(h('div', { class: 'stack' }, header, recCard, grid, logs, dialog));

  function card(l) {
    const t = h('button', { class: 'thumb', onclick: () => openPlayer(l), 'aria-label': `Play ${l.title}` },
      h('img', { src: l.thumbnail, alt: '', loading: 'lazy', width: 480, height: 360, onerror: (e) => e.currentTarget.remove() }), h('span', { class: 'play', 'aria-hidden': 'true' }, '▶'));
    return h('article', { class: 'card video' }, t, h('div', { class: 'body' },
      h('h3', {}, l.title),
      h('div', { class: 'chips' },
        h('span', { class: `badge ${l.difficulty === 'unknown' ? 'warn' : 'ok'}`, title: l.difficultyEvidence }, l.difficulty === 'unknown' ? 'level unknown' : `${l.difficulty} (per title)`),
        h('span', { class: 'badge' }, l.series), l.topics.map((x) => h('span', { class: 'badge' }, x)),
        l.watched ? h('span', { class: 'badge ok' }, `watched ×${l.watched}`) : null, l.saved ? h('span', { class: 'badge warn' }, '★ saved') : null),
      h('div', { class: 'small muted' }, `Published ${l.published}`),
      h('div', { class: 'row' }, h('button', { class: 'btn small primary', onclick: () => openPlayer(l) }, 'Watch'),
        h('a', { class: 'btn small', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, 'YouTube ↗'))));
  }

  function openPlayer(l) {
    if (!l) return;
    const note = h('textarea', { 'aria-label': 'Personal note', placeholder: 'Your notes (words you caught, what confused you)…', maxlength: 500 });
    let rating = 0;
    const stars = h('div', { class: 'stars', role: 'radiogroup', 'aria-label': 'How much did you understand?' },
      [1, 2, 3, 4, 5].map((n) => h('button', { class: 'btn small', role: 'radio', 'aria-checked': 'false', 'aria-label': `${n} out of 5`, onclick: (e) => { rating = n; for (const [i, b] of [...stars.children].entries()) { b.setAttribute('aria-checked', String(i + 1 === n)); b.textContent = i < n ? '★' : '☆'; } } }, '☆')));
    const logId = uuid(); // makes the request idempotent
    const player = l.embeddable === false
      ? h('div', { class: 'empty' }, 'The publisher has not enabled embedding for this video. Use the link below to watch on YouTube.')
      : h('div', { class: 'player' }, h('iframe', { src: `${l.embedUrl}?rel=0`, title: l.title, loading: 'lazy', allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture', referrerpolicy: 'strict-origin-when-cross-origin', allowfullscreen: true }));
    clear(dialog).append(h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('h2', {}, l.title), h('form', { method: 'dialog' }, h('button', { class: 'btn small' }, 'Close'))),
      player,
      h('p', { class: 'small muted' }, 'Video not loading (offline, blocked, or removed)? ', h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open it on YouTube'), '. Your history and notes still work.'),
      h('div', { class: 'card flat' }, h('strong', {}, 'Transcript'), h('p', { class: 'small' }, l.hasTranscript ? 'Available.' : 'No legitimate transcript is available for this video, so transcript practice is not offered. Nothing here is auto-generated or attributed to Lazy Benkyou.')),
      h('div', { class: 'stack' }, h('strong', {}, 'How much did you understand?'), stars, note,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: async (e) => {
            if (!rating) return toast('Pick a rating from 1 to 5 first');
            const b = e.currentTarget; b.disabled = true;
            try { await api.logListening(l.id, { logId, rating, note: note.value.trim() }); toast('Saved to episodic memory'); dialog.close(); render(main, { showError }); } catch (err) { b.disabled = false; toast(err.message); }
          } }, 'Log comprehension'),
          h('button', { class: 'btn', onclick: async () => { try { await api.saveLesson(l.id, !l.saved); toast(l.saved ? 'Removed from saved' : 'Saved'); dialog.close(); render(main, { showError }); } catch (err) { toast(err.message); } } }, l.saved ? 'Unsave' : '★ Save lesson'))),
      h('p', { class: 'small muted' }, 'Low ratings (1–2) feed the Planner: it will recommend revising concepts linked to this lesson’s topic.')));
    dialog.addEventListener('close', () => clear(dialog), { once: true });
    dialog.showModal();
  }
}
