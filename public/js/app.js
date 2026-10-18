import { api, ApiError, getMe, setMe, isDemoView, setViewDemo, DEMO_LEARNER } from './api.js';
import { h, clear, toast } from './utils.js';

const routes = {
  '': () => import('./dashboard.js'),
  practice: () => import('./learning.js'),
  library: () => import('./library.js'),
  listening: () => import('./listening.js'),
  memory: () => import('./memory.js'),
  signin: () => import('./auth.js'),
  signup: () => import('./auth.js'),
};
const main = document.getElementById('main');
let renderToken = 0;

export function showError(container, err, retry) {
  clear(container).append(h('div', { class: 'error-box', role: 'alert' },
    h('strong', {}, err instanceof ApiError && err.code === 'db_unavailable' ? 'The graph database is starting up' : 'Something went wrong'),
    h('p', {}, err.message || String(err)),
    retry ? h('button', { class: 'btn', onclick: retry }, 'Try again') : null));
}

const currentRoute = () => (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]) || '';

async function render() {
  const token = ++renderToken;
  const route = currentRoute();
  const loader = routes[route] ?? routes[''];
  updateBanner();
  for (const a of document.querySelectorAll('#nav a')) {
    if (a.dataset.route === route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  // Each render gets its own container, so a slower earlier view that finishes late writes into a detached element.
  const view = h('div', {}, h('p', { class: 'loading' }, 'Loading…'));
  clear(main).append(view);
  try {
    const mod = await loader();
    if (token !== renderToken) return;
    clear(view);
    await mod.render(view, { showError: (e, r) => showError(view, e, r), rerender: render });
  } catch (err) {
    if (token === renderToken) showError(view, err, render);
  }
  if (token === renderToken) { main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
}

const forgetPractice = () => { try { sessionStorage.removeItem('session'); } catch { /* ignore */ } };

/** The account area in the top bar: a sign-in link without an account; profile switcher and sign-out with one (guests too). */
function renderAccount() {
  const el = clear(document.getElementById('account'));
  const me = getMe();
  if (!me.signedIn) {
    el.append(h('a', { class: 'btn small primary', href: '#/signin' }, 'Sign in'));
    return;
  }
  const sel = h('select', { id: 'profile' },
    h('option', { value: me.learner.id }, me.guest ? 'My path (guest)' : `My path (${me.learner.name})`),
    h('option', { value: DEMO_LEARNER }, 'Demo learner (Aiko)'));
  sel.value = isDemoView() ? DEMO_LEARNER : me.learner.id;
  sel.addEventListener('change', () => {
    setViewDemo(sel.value === DEMO_LEARNER);
    forgetPractice();
    updateBanner();
    toast(isDemoView() ? 'Viewing the demo learner' : 'Viewing your own learning path');
    render();
  });
  const out = h('button', { class: 'btn small ghost', type: 'button', title: me.email ?? 'Guest account' }, 'Sign out');
  out.addEventListener('click', async () => {
    // Nothing else leads back to a guest account, so the server deletes it on sign-out.
    if (me.guest && !window.confirm('Signing out of a guest account deletes its progress for good. Sign in with Google first to keep it. Sign out anyway?')) return;
    out.disabled = true;
    try { setMe(await api.signOut()); } catch (err) { out.disabled = false; toast(err.message); return; }
    setViewDemo(false); forgetPractice();
    refreshChrome(); toast('Signed out');
    location.hash = '#/'; render();
  });
  el.append(h('label', { class: 'profile' }, h('span', { class: 'sr' }, 'Learner profile'), sel));
  if (me.guest) el.append(h('a', { class: 'btn small primary', href: '#/signin' }, 'Save with Google'));
  el.append(out);
}

function refreshChrome() { renderAccount(); updateBanner(); }

async function init() {
  window.addEventListener('hashchange', render);
  window.addEventListener('auth:changed', (e) => { refreshChrome(); if (e.detail?.message) toast(e.detail.message); });
  // The sign-in ended (expired or signed out elsewhere): fall back to guest and ask to sign in again.
  window.addEventListener('auth:expired', () => {
    if (!getMe().signedIn) return;
    const wasGuest = getMe().guest;
    setMe({ signedIn: false, learner: { id: DEMO_LEARNER, name: '' } }); forgetPractice();
    refreshChrome(); toast(wasGuest ? 'Your guest account has ended.' : 'Your sign-in has expired. Please sign in again.');
    location.hash = '#/signin';
  });
  try { setMe(await api.me()); } catch { /* server not ready: continue without an account */ }
  // Back from Google (/api/auth/google/callback redirects to #/?signedin=google).
  const back = new URLSearchParams(location.hash.split('?')[1] || '');
  if (back.get('signedin') === 'google') {
    history.replaceState(null, '', '#/');
    if (getMe().signedIn) {
      setViewDemo(false); forgetPractice();
      toast(back.get('guest') === 'left'
        ? `Signed in as ${getMe().learner.name}. You already had an account, so the guest progress was not moved into it.`
        : `Signed in as ${getMe().learner.name}`);
    } else location.hash = '#/signin?error=cookie_blocked';
  }
  refreshChrome();
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
  const el = clear(document.getElementById('banner'));
  const me = getMe();
  if (['signin', 'signup'].includes(currentRoute()) || (!isDemoView() && !me.guest)) { el.hidden = true; return; }
  el.hidden = false; el.className = 'banner demo';
  if (!isDemoView()) {
    el.append('You are using a guest account: your progress is saved in this browser only. ', h('a', { href: '#/signin' }, 'Sign in with Google'), ' to keep it on any device.');
    return;
  }
  el.append('You are viewing the demo learner “Aiko”. Her earlier sessions are pre-seeded demo data; anything you answer now is recorded as live activity.');
  if (!me.signedIn) el.append(' ', h('a', { href: '#/signin' }, 'Sign in with Google or continue as a guest'), ' to start your own learning path.');
}

init();
