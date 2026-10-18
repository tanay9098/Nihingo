// Sign in with Google: OAuth 2.0 authorization-code flow with PKCE, using only `fetch` and `node:crypto` (no SDK).
// The ID token is taken straight from Google's token endpoint over TLS, authenticated with the client secret, so its
// claims are trusted without checking the signature (as Google documents for this flow); iss/aud/exp/nonce are still checked.
import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from './learning.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const rand = () => randomBytes(32).toString('base64url');

export class GoogleAuth {
  constructor({ clientId, clientSecret, fetch = globalThis.fetch, clock = Date.now }) {
    Object.assign(this, { clientId, clientSecret, fetch, clock });
  }

  get enabled() { return !!(this.clientId && this.clientSecret); }

  /** The Google consent URL plus the values the callback must see again (kept in a short-lived HttpOnly cookie). */
  start(redirectUri) {
    const flow = { state: rand(), verifier: rand(), nonce: rand() };
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: this.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
      state: flow.state, nonce: flow.nonce, code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
      code_challenge_method: 'S256', prompt: 'select_account',
    });
    return { url: url.toString(), flow };
  }

  /** Exchanges the authorization code and returns the verified Google identity. */
  async finish({ code, redirectUri, flow }) {
    let res;
    try {
      res = await this.fetch(TOKEN_URL, {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: this.clientId, client_secret: this.clientSecret, redirect_uri: redirectUri,
          grant_type: 'authorization_code', code_verifier: flow.verifier,
        }),
      });
    } catch { throw new HttpError(502, 'Could not reach Google. Please try again.', 'google_failed'); }
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.id_token) {
      console.error('[google] token exchange failed:', res.status, body?.error, body?.error_description);
      throw new HttpError(502, 'Google sign-in failed. Please try again.', 'google_failed');
    }
    let claims;
    try { claims = JSON.parse(Buffer.from(String(body.id_token).split('.')[1], 'base64url').toString('utf8')); } catch { claims = null; }
    if (!claims || !ISSUERS.includes(claims.iss) || claims.aud !== this.clientId || !(claims.exp * 1000 > this.clock()) || claims.nonce !== flow.nonce || !claims.sub) {
      throw new HttpError(502, 'Google sign-in returned an invalid identity.', 'google_failed');
    }
    if (claims.email_verified !== true || !claims.email) throw new HttpError(403, 'Your Google account has no verified email address.', 'google_unverified');
    return { sub: String(claims.sub), email: String(claims.email), name: String(claims.name || claims.given_name || '') };
  }
}
