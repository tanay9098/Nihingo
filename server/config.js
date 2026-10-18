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
  falkor: {
    host: env.FALKORDB_HOST || 'localhost',
    port: Number(env.FALKORDB_PORT) || 6380,
    password: env.FALKORDB_PASSWORD || undefined,
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
  },
};

// "ai" only when a provider, key and model are all configured; otherwise deterministic demo mode.
export function appMode(cfg = config) {
  return cfg.llm.provider && cfg.llm.apiKey && cfg.llm.model ? 'ai' : 'demo';
}
