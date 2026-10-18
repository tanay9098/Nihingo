// Learner accounts. Every account owns exactly one Learner node whose id the server generates
// (`learner:<uuid>`), so each learner's memory and learning path is separate by construction.
// Accounts sign in with Google, or are guest accounts reachable only from the browser holding their cookie. The older
// email + password accounts (scrypt hashes) still work when PASSWORD_AUTH=1 and can be reached with Google via the same email.
// Sign-in sessions are random tokens of which only a SHA-256 hash is stored.
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { HttpError } from './learning.js';

const scrypt = promisify(scryptCb);
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
export const PASSWORD_MIN = 8;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored ?? '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return timingSafeEqual(key, expected);
}

// Checked against when the email is unknown, so a failed sign-in takes as long whether or not the account exists.
let dummyHash;
const dummy = () => (dummyHash ??= hashPassword(randomUUID()));

const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const isUniqueViolation = (err) => /unique constraint/i.test(err?.message || '');

export function normalizeEmail(email) {
  const e = String(email ?? '').trim().toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e)) throw new HttpError(400, 'Enter a valid email address', 'validation');
  return e;
}

export class AuthService {
  constructor({ memory, ttlMs = config.auth.sessionTtlMs, guestTtlMs = config.auth.guestTtlMs, clock = Date.now }) {
    Object.assign(this, { memory, ttlMs, guestTtlMs, clock });
  }

  /**
   * Signs in with a verified Google identity: the account linked to it, else the account with the same email (linked now),
   * else the current guest account (which keeps its progress), else a new account. `current` is the caller's sign-in, if any.
   */
  async signInWithGoogle({ sub, email, name, current = null }) {
    const e = normalizeEmail(email);
    const displayName = String(name ?? '').trim().slice(0, 60) || e.split('@')[0];
    let account = await this.memory.getAccountByGoogleSub(sub);
    if (!account) {
      const byEmail = await this.memory.getAccountByEmail(e);
      if (byEmail?.googleSub) throw new HttpError(409, 'This email address belongs to an account linked to a different Google account.', 'email_taken');
      const target = byEmail ?? (current?.guest ? { id: current.accountId } : null);
      try {
        if (target) account = await this.memory.linkGoogle(target.id, { googleSub: sub, email: e, name: displayName });
        else {
          const a = { id: `acct:${randomUUID()}`, email: e, googleSub: sub, kind: 'google', profileId: `learner:${randomUUID()}` };
          if (await this.memory.createAccount({ ...a, name: displayName, now: this.clock() })) account = a;
        }
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
      account ??= await this.memory.getAccountByGoogleSub(sub); // a parallel sign-in created it first
      if (!account) throw new HttpError(409, 'Could not create the account. Please try again.', 'email_taken');
    }
    const session = await this.#startSession(account);
    // A guest who signs in to an account that already existed leaves the guest progress behind.
    return { ...session, guestLeft: !!current?.guest && current.accountId !== account.id };
  }

  /** A new guest account with its own learner; its only key is the sign-in cookie of this browser. */
  async startGuest() {
    const account = { id: `acct:${randomUUID()}`, kind: 'guest', profileId: `learner:${randomUUID()}` };
    await this.memory.createAccount({ ...account, name: 'Guest', now: this.clock() });
    return this.#startSession(account);
  }

  async signUp({ email, password, name }) {
    const e = normalizeEmail(email);
    if (typeof password !== 'string' || password.length < PASSWORD_MIN) throw new HttpError(400, `Password must be at least ${PASSWORD_MIN} characters`, 'validation');
    const displayName = String(name ?? '').trim().slice(0, 60) || e.split('@')[0];
    const account = { id: `acct:${randomUUID()}`, email: e, profileId: `learner:${randomUUID()}` };
    let created;
    try {
      created = await this.memory.createAccount({ ...account, passwordHash: await hashPassword(password), name: displayName, now: this.clock() });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      created = false;
    }
    if (!created) throw new HttpError(409, 'An account with this email already exists. Sign in instead.', 'email_taken');
    return this.#startSession(account);
  }

  async signIn({ email, password }) {
    let e;
    try { e = normalizeEmail(email); } catch { e = ''; }
    const account = e ? await this.memory.getAccountByEmail(e) : null;
    const valid = await verifyPassword(String(password ?? ''), account?.passwordHash ?? await dummy());
    if (!account || !valid) throw new HttpError(401, 'Email or password is incorrect', 'bad_credentials');
    return this.#startSession(account);
  }

  /** The signed-in account for a session token, or null when the token is unknown or expired. */
  async resolve(token) {
    if (!token || token.length > 128) return null;
    const s = await this.memory.getAuthSession(tokenHash(token));
    if (!s) return null;
    const now = this.clock();
    if (s.expiresAt <= now) { await this.memory.deleteAuthSession(s.id); return null; }
    const guest = s.kind === 'guest';
    const auth = { accountId: s.accountId, email: guest ? null : s.email, learnerId: s.profileId, guest };
    // A guest account is kept alive while it is used: past half its lifetime the sign-in (and its cookie) is extended.
    if (guest && s.expiresAt - now < this.guestTtlMs / 2) {
      auth.renewedUntil = now + this.guestTtlMs;
      await this.memory.extendAuthSession(s.id, auth.renewedUntil);
    }
    return auth;
  }

  /** Ends the sign-in. Signing out of a guest account deletes it: nothing could ever reach its progress again. */
  async signOut(token) {
    if (!token || token.length > 128) return;
    const s = await this.memory.getAuthSession(tokenHash(token));
    if (s?.kind === 'guest') await this.memory.deleteAccount(s.accountId);
    else await this.memory.deleteAuthSession(tokenHash(token));
  }

  async #startSession(account) {
    const token = randomBytes(32).toString('base64url');
    const now = this.clock();
    const guest = account.kind === 'guest';
    const expiresAt = now + (guest ? this.guestTtlMs : this.ttlMs);
    await this.memory.createAuthSession({ id: tokenHash(token), accountId: account.id, profileId: account.profileId, createdAt: now, expiresAt });
    return { token, expiresAt, auth: { accountId: account.id, email: guest ? null : account.email, learnerId: account.profileId, guest } };
  }
}
