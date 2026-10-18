// Sign in / create account. Each account gets its own learner, so its learning path and memory start empty
// and are never shared. Guests can keep using the demo learner without an account.
import { api, getMe, setMe, setViewDemo } from './api.js';
import { h, clear } from './utils.js';

const PASSWORD_MIN = 8;

function field(label, attrs) {
  const input = h('input', { ...attrs, id: `auth-${attrs.name}` });
  return { input, el: h('label', { class: 'auth-field', for: input.id }, h('span', {}, label), input) };
}

export async function render(main) {
  const signup = location.hash.replace(/^#\/?/, '').startsWith('signup');
  if (getMe().signedIn) { location.hash = '#/'; return; }

  const name = signup ? field('Name (optional)', { type: 'text', name: 'name', autocomplete: 'name', maxlength: 60 }) : null;
  const email = field('Email', { type: 'email', name: 'email', autocomplete: 'email', required: true, maxlength: 254 });
  const password = field('Password', {
    type: 'password', name: 'password', required: true, maxlength: 128,
    autocomplete: signup ? 'new-password' : 'current-password', minlength: signup ? PASSWORD_MIN : null, 'aria-describedby': signup ? 'auth-password-hint' : null,
  });
  const error = h('div', { class: 'error-box', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, signup ? 'Create account' : 'Sign in');

  const form = h('form', { class: 'stack', novalidate: true },
    name?.el, email.el, password.el,
    signup ? h('p', { class: 'small muted', id: 'auth-password-hint' }, `At least ${PASSWORD_MIN} characters.`) : null,
    error, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    if (!email.input.value.trim() || !password.input.value) { showError('Enter your email and password.'); return; }
    if (signup && password.input.value.length < PASSWORD_MIN) { showError(`Password must be at least ${PASSWORD_MIN} characters.`); return; }
    submit.disabled = true;
    try {
      const body = { email: email.input.value.trim(), password: password.input.value };
      const me = signup ? await api.signUp({ ...body, name: name.input.value.trim() }) : await api.signIn(body);
      // The sign-in only exists in the session cookie. Ask the server whether it came back with this request; if the browser
      // dropped it (cookies blocked, or a Secure cookie on plain http), staying "signed in" here would show the demo learner's data.
      const check = await api.me();
      if (!check.signedIn || check.learner.id !== me.learner.id) {
        submit.disabled = false;
        showError(`${signup ? 'Your account was created, but this' : 'Your password was accepted, but this'} browser did not keep the sign-in cookie, so you are still a guest. `
          + 'Allow cookies for this site. If the app is served over plain http://, it must run with COOKIE_SECURE=0 or be served over HTTPS.');
        return;
      }
      setMe(me); setViewDemo(false);
      try { sessionStorage.removeItem('session'); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent('auth:changed', { detail: { message: signup ? `Welcome, ${me.learner.name}! Your learning path starts here.` : `Signed in as ${me.learner.name}` } }));
      location.hash = '#/';
    } catch (err) {
      submit.disabled = false;
      showError(err.message);
    }
  });
  function showError(msg) { error.textContent = msg; error.hidden = false; }

  clear(main).append(h('section', { class: 'card auth-card stack', 'aria-labelledby': 'auth-h' },
    h('nav', { class: 'auth-tabs', 'aria-label': 'Account' },
      h('a', { href: '#/signin', 'aria-current': signup ? null : 'page' }, 'Sign in'),
      h('a', { href: '#/signup', 'aria-current': signup ? 'page' : null }, 'Create account')),
    h('h1', { id: 'auth-h' }, signup ? 'Start your own learning path' : 'Welcome back'),
    h('p', { class: 'muted' }, signup
      ? 'Your account gets its own learner memory: sessions, mistakes, mastery and preferences that belong to you alone.'
      : 'Sign in to continue your learning path where you left off.'),
    form,
    h('p', { class: 'small muted' }, 'Just looking? ', h('a', { href: '#/' }, 'Continue as a guest with the demo learner'), '.')));
  (name ?? email).input.focus();
}
