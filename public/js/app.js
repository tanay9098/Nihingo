import { api, ApiError, getLearner, setLearner } from './api.js';
import { h, clear, toast } from './utils.js';

const routes = {
  '': () => import('./dashboard.js'),
  practice: () => import('./learning.js'),
  library: () => import('./library.js'),
  listening: () => import('./listening.js'),
  memory: () => import('./memory.js'),
};
const main = document.getElementById('main');
let renderToken = 0;

export function showError(container, err, retry) {
  clear(container).append(h('div', { class: 'error-box', role: 'alert' },
    h('strong', {}, err instanceof ApiError && err.code === 'db_unavailable' ? 'The graph database is starting up' : 'Something went wrong'),
    h('p', {}, err.message || String(err)),
    retry ? h('button', { class: 'btn', onclick: retry }, 'Try again') : null));
}

async function render() {
  const token = ++renderToken;
  const route = (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]) || '';
  const loader = routes[route] ?? routes[''];
  for (const a of document.querySelectorAll('#nav a')) {
    if (a.dataset.route === route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  clear(main).append(h('p', { class: 'loading' }, 'Loading…'));
  try {
    const mod = await loader();
    if (token !== renderToken) return;
    clear(main);
    await mod.render(main, { showError: (e, r) => showError(main, e, r), rerender: render });
  } catch (err) {
    if (token === renderToken) showError(main, err, render);
  }
  if (token === renderToken) { main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
}

async function init() {
  const sel = document.getElementById('profile');
  sel.value = getLearner();
  sel.addEventListener('change', () => {
    setLearner(sel.value);
    try { sessionStorage.removeItem('session'); } catch { /* ignore */ }
    updateBanner();
    toast(sel.value === 'learner:demo' ? 'Viewing the demo learner' : 'Viewing your own profile');
    render();
  });
  window.addEventListener('hashchange', render);
  updateBanner();
  try {
    const hd = await api.health();
    const b = document.getElementById('mode-badge');
    b.textContent = hd.mode === 'ai' ? 'AI mode' : 'Demo mode';
    b.className = `badge ${hd.mode === 'ai' ? 'ai' : 'demo'}`;
    b.title = hd.mode === 'ai'
      ? 'An LLM provider is configured; explanations are model-written but grounded in graph evidence.'
      : 'No LLM configured: deterministic agents, real FalkorDB persistence.';
  } catch (err) {
    const b = document.getElementById('mode-badge');
    b.textContent = 'offline'; b.className = 'badge bad';
  }
  render();
}

export function updateBanner() {
  const el = document.getElementById('banner');
  if (getLearner() === 'learner:demo') {
    el.hidden = false; el.className = 'banner demo';
    el.textContent = 'You are viewing the demo learner “Aiko”. Her earlier sessions are pre-seeded demo data; anything you answer now is recorded as live activity.';
  } else el.hidden = true;
}

init();
