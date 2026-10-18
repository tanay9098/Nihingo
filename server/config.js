import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Node 20.12+/22 can load .env natively. A missing file is fine.
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env: use process env / defaults */ }

const env = process.env;
const llmKey = (env.LLM_API_KEY || '').trim();
const provider = (env.LLM_PROVIDER || '').trim().toLowerCase();

export const config = {
  port: Number(env.PORT) || 3002,
  rootDir: ROOT,
  publicDir: path.join(ROOT, 'public'),
  resourcesDir: path.resolve(ROOT, env.RESOURCES_DIR || 'resources'),
  autoBootstrap: env.AUTO_BOOTSTRAP !== '0',
  // Behind a reverse proxy (Render, Fly, nginx, …) set TRUST_PROXY=1 so the client IP (rate limits) and https are read from X-Forwarded-*.
  trustProxy: env.TRUST_PROXY === '1',
  falkor: {
    host: env.FALKORDB_HOST || 'localhost',
    port: Number(env.FALKORDB_PORT) || 6380,
    username: env.FALKORDB_USERNAME || undefined,
    password: env.FALKORDB_PASSWORD || undefined,
    // Encrypted connection (e.g. FalkorDB Cloud). Off by default: the bundled Compose database is plain TCP.
    tls: env.FALKORDB_TLS === '1',
    graph: env.FALKORDB_GRAPH || 'nihongo',
    queryTimeoutMs: Number(env.FALKORDB_QUERY_TIMEOUT_MS) || 8000,
  },
  llm: {
    provider: ['anthropic', 'openai'].includes(provider) ? provider : '',
    apiKey: llmKey,
    model: env.LLM_MODEL || '',
    baseUrl: env.LLM_BASE_URL || '',
  },
  ragUrl: (env.GRAPHRAG_URL || '').trim(),
  auth: {
    sessionTtlMs: (Number(env.SESSION_TTL_DAYS) || 30) * 24 * 60 * 60 * 1000,
    // Send the session cookie only over HTTPS. Turn on whenever the app is served over HTTPS.
    cookieSecure: env.COOKIE_SECURE === '1',
    // A guest account lives only in this browser's cookie; it is kept alive while used and removed after this long unused.
    guestTtlMs: (Number(env.GUEST_TTL_DAYS) || 180) * 24 * 60 * 60 * 1000,
    // Email + password sign-in is off by default (sign-in is with Google); PASSWORD_AUTH=1 re-enables the old endpoints.
    passwordAuth: env.PASSWORD_AUTH === '1',
  },
  // Sign in with Google (OAuth 2.0 authorization-code flow with PKCE). Enabled when both the id and the secret are set.
  google: {
    clientId: (env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: (env.GOOGLE_CLIENT_SECRET || '').trim(),
    // Must match an "Authorized redirect URI" of the OAuth client. Empty: derived from the request (<origin>/api/auth/google/callback).
    redirectUri: (env.GOOGLE_REDIRECT_URI || '').trim(),
  },
};

// "ai" only when a provider, key and model are all configured; otherwise deterministic demo mode.
export function appMode(cfg = config) {
  return cfg.llm.provider && cfg.llm.apiKey && cfg.llm.model ? 'ai' : 'demo';
}
