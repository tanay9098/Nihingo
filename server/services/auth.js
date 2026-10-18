// Learner accounts. Every account owns exactly one Learner node whose id the server generates
// (`learner:<uuid>`), so each learner's memory and learning path is separate by construction.
// Passwords are stored as scrypt hashes; sign-in sessions are random tokens of which only a SHA-256 hash is stored.
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
  constructor({ memory, ttlMs = config.auth.sessionTtlMs, clock = Date.now }) {
    Object.assign(this, { memory, ttlMs, clock });
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
    if (s.expiresAt <= this.clock()) { await this.memory.deleteAuthSession(s.id); return null; }
    return { accountId: s.accountId, email: s.email, learnerId: s.profileId };
  }

  async signOut(token) {
    if (token && token.length <= 128) await this.memory.deleteAuthSession(tokenHash(token));
  }

  async #startSession(account) {
    const token = randomBytes(32).toString('base64url');
    const now = this.clock();
    const expiresAt = now + this.ttlMs;
    await this.memory.createAuthSession({ id: tokenHash(token), accountId: account.id, profileId: account.profileId, createdAt: now, expiresAt });
    return { token, expiresAt, auth: { accountId: account.id, email: account.email, learnerId: account.profileId } };
  }
}
