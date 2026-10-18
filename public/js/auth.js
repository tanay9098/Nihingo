// Sign in with Google, or continue as a guest. Every account (guest ones too) gets its own learner, so its learning path
// and memory start empty and are never shared. A guest account lives only in this browser; signing in with Google keeps
// its progress. Without either, a visitor just looks at the demo learner.
import { api, getMe, setMe, setViewDemo } from './api.js';
import { h, clear } from './utils.js';

const ERRORS = {
  google_disabled: 'Google sign-in is not set up on this server yet.',
  google_cancelled: 'Google sign-in was cancelled.',
  google_state: 'The Google sign-in expired or was started in another tab. Please try again.',
  google_unverified: 'Your Google account has no verified email address.',
  google_failed: 'Google sign-in failed. Please try again.',
  email_taken: 'This email address already belongs to an account linked to a different Google account.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  cookie_blocked: 'This browser did not keep the sign-in cookie. Allow cookies for this site and try again.',
};

export async function render(main) {
  const me = getMe();
  if (me.signedIn && !me.guest) { location.hash = '#/'; return; }
  const code = new URLSearchParams(location.hash.split('?')[1] || '').get('error');
  let options = { google: false, guest: true };
  try { options = await api.authOptions(); } catch { /* server not ready: Google stays hidden, guest shows its own error */ }

  const error = h('div', { class: 'error-box', role: 'alert', hidden: !code }, code ? ERRORS[code] || ERRORS.google_failed : '');
  function showError(msg) { error.textContent = msg; error.hidden = false; }

  // A plain navigation, not fetch: the server redirects to Google and Google redirects back to /api/auth/google/callback.
  const google = options.google
    ? h('a', { class: 'btn primary google', href: '/api/auth/google/start' }, h('span', { class: 'g-mark', 'aria-hidden': 'true' }, 'G'), 'Continue with Google')
    : h('p', { class: 'small muted' }, 'Google sign-in is not set up on this server yet.');

  let guest = null;
  if (!me.signedIn) {
    guest = h('button', { class: 'btn', type: 'button' }, 'Continue as guest');
    guest.addEventListener('click', async () => {
      error.hidden = true;
      guest.disabled = true;
      try {
        const next = await api.startGuest();
        // The guest account only exists in the session cookie. If the browser dropped it, this would still be the demo learner.
        const check = await api.me();
        if (!check.signedIn || check.learner.id !== next.learner.id) { guest.disabled = false; showError(ERRORS.cookie_blocked); return; }
        setMe(next); setViewDemo(false);
        try { sessionStorage.removeItem('session'); } catch { /* ignore */ }
        window.dispatchEvent(new CustomEvent('auth:changed', { detail: { message: 'Guest account created. Your progress is saved in this browser.' } }));
        location.hash = '#/';
      } catch (err) {
        guest.disabled = false;
        showError(err.message);
      }
    });
  }

  clear(main).append(h('section', { class: 'card auth-card stack', 'aria-labelledby': 'auth-h' },
    h('h1', { id: 'auth-h' }, me.guest ? 'Keep your guest progress' : 'Start your own learning path'),
    h('p', { class: 'muted' }, me.guest
      ? 'Sign in with Google and your guest learning path moves into your Google account, so you can continue on any device. If you already have an account, you will sign in to it instead and the guest progress stays behind.'
      : 'Your account keeps its own progress: sessions, mistakes, what you know and your preferences, belonging to you alone. No password needed.'),
    error,
    google,
    guest ? h('div', { class: 'stack' },
      h('div', { class: 'auth-or', 'aria-hidden': 'true' }, 'or'),
      guest,
      h('p', { class: 'small muted' }, 'A guest account needs no sign-in. Its progress is kept for this browser only: clearing site data, using another browser or signing out of the guest account loses it.')) : null,
    h('p', { class: 'small muted' }, 'Just looking? ', h('a', { href: '#/' }, me.guest ? 'Back to your guest path' : 'Browse the demo learner'), '.')));
  (main.querySelector('.btn') ?? main).focus?.();
}
