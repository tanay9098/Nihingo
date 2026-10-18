// Lightweight SVG graph renderer: radial layout, no libraries. Bounded by the server (<= 80 nodes).
import { h, svg, clear, pct, STATUS_LABEL } from './utils.js';

const W = 640, H = 460, CX = W / 2, CY = H / 2;
const GROUP_LABEL = { Learner: 'Learner', vocabulary: 'Vocabulary', grammar: 'Grammar', kanji: 'Kanji', kana: 'Letter (kana)', Topic: 'Topic', Lesson: 'Lesson', Recommendation: 'Recommendation', LearningPreference: 'Preference', Resource: 'Lesson source' };

export function layout(data) {
  const pos = new Map();
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  pos.set(data.center, { x: CX, y: CY, depth: 0 });
  const adj = new Map();
  for (const e of data.edges) {
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)).push(e.target);
    (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)).push(e.source);
  }
  const ring1 = (adj.get(data.center) || []).filter((id, i, a) => a.indexOf(id) === i && byId.has(id));
  const r1 = Math.min(W, H) * 0.3;
  ring1.forEach((id, i) => {
    const a = (2 * Math.PI * i) / ring1.length - Math.PI / 2;
    pos.set(id, { x: CX + r1 * Math.cos(a), y: CY + r1 * Math.sin(a) * 0.95, depth: 1, angle: a });
  });
  const kids = new Map();
  for (const n of data.nodes) {
    if (pos.has(n.id)) continue;
    const parent = (adj.get(n.id) || []).find((p) => pos.has(p) && pos.get(p).depth === 1);
    if (parent) (kids.get(parent) ?? kids.set(parent, []).get(parent)).push(n.id);
  }
  for (const [parent, list] of kids) {
    const p = pos.get(parent);
    list.forEach((id, i) => {
      const spread = Math.min(1.2, 0.35 * list.length);
      const a = p.angle + (list.length === 1 ? 0 : (i / (list.length - 1) - 0.5) * spread);
      pos.set(id, { x: CX + (r1 + 120) * Math.cos(a), y: CY + (r1 + 105) * Math.sin(a), depth: 2 });
    });
  }
  let k = 0;
  for (const n of data.nodes) if (!pos.has(n.id)) pos.set(n.id, { x: 40 + (k++ * 53) % (W - 80), y: H - 24, depth: 3 });
  return pos;
}

export function renderGraph(container, data, { onSelect, caption } = {}) {
  clear(container);
  if (!data.nodes.length || data.nodes.length === 1) {
    container.append(h('div', { class: 'empty' }, 'Nothing is linked to this yet. Complete a practice session to grow your learning map.'));
    return;
  }
  const pos = layout(data);
  const root = svg('svg', { class: 'graph', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': caption || 'Knowledge graph neighbourhood' });
  const edges = svg('g');
  for (const e of data.edges) {
    const a = pos.get(e.source), b = pos.get(e.target);
    if (!a || !b) continue;
    edges.append(svg('line', { class: `edge ${e.status || ''}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y }, svg('title', {}, `${String(e.type).toLowerCase().replace(/_/g, ' ')}${e.mastery != null ? ` · ${pct(e.mastery)} known` : ''}`)));
  }
  root.append(edges);
  for (const n of data.nodes) {
    const p = pos.get(n.id);
    const r = n.center ? 22 : n.group === 'Topic' ? 11 : 15;
    const g = svg('g', { class: 'node', transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`, tabindex: 0, role: 'button', 'aria-label': `${n.label} (${GROUP_LABEL[n.group] || n.group}${n.status ? `, ${STATUS_LABEL[n.status] || n.status}` : ''})` },
      svg('circle', { r, class: `g-${n.group}` }),
      svg('text', { y: r + 13 }, n.label.length > 14 ? `${n.label.slice(0, 13)}…` : n.label),
      svg('title', {}, `${n.label} — ${GROUP_LABEL[n.group] || n.group}${n.mastery != null ? ` · ${pct(n.mastery)} known` : ''}`));
    if (onSelect && !n.center) {
      const pick = () => { root.querySelector('.node.selected')?.classList.remove('selected'); g.classList.add('selected'); onSelect(n.id, n); };
      g.addEventListener('click', pick);
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
    }
    root.append(g);
  }
  container.append(root, legend(data));
  if (data.truncated) container.append(h('p', { class: 'small muted', style: null }, `Showing the closest ${data.limit} items only.`));
}

function legend(data) {
  const seen = [...new Set(data.nodes.map((n) => n.group))];
  const sw = (g) => { const s = svg('svg', { width: 12, height: 12, 'aria-hidden': 'true' }, svg('circle', { cx: 6, cy: 6, r: 6, class: `g-${g}` })); return s; };
  return h('div', { class: 'legend' }, seen.map((g) => h('span', {}, sw(g), ' ', GROUP_LABEL[g] || g)),
    h('span', {}, 'Line colour: ', ['struggling', 'learning', 'mastered'].map((st, i) => [i ? ' · ' : '', h('b', { class: `line-${st}` }, STATUS_LABEL[st])])));
}
