// Optional LLM access for AI mode. Server-side only; the key never reaches the browser.
// Every call is wrapped so any failure (no key, network, bad JSON, failed validation) falls back to the
// deterministic text produced by the agents.
import { config, appMode } from '../config.js';

const TIMEOUT_MS = 15000;

async function callProvider(cfg, system, user) {
  const { provider, apiKey, model, baseUrl } = cfg.llm;
  if (provider === 'anthropic') {
    const res = await fetch(`${baseUrl || 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 500, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const body = await res.json();
    return body.content?.map((c) => c.text ?? '').join('') ?? '';
  }
  const res = await fetch(`${baseUrl || 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: 500, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const body = await res.json();
  return body.choices?.[0]?.message?.content ?? '';
}

/**
 * Ask the model for JSON and validate it. `validate(obj)` must return the cleaned object or throw.
 * @returns {Promise<{ok:true, value:any} | {ok:false, reason:string}>}
 */
export async function askJson({ system, user, validate, cfg = config }) {
  if (appMode(cfg) !== 'ai') return { ok: false, reason: 'demo mode (no LLM configured)' };
  try {
    const text = await callProvider(cfg, `${system}\nReply with a single JSON object and nothing else.`, user);
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    return { ok: true, value: validate(json) };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/** Numbers in generated text must appear in the evidence it was given (cheap hallucination guard). */
export function numbersSubset(text, evidenceText) {
  const nums = (s) => new Set(String(s).match(/\d+(?:\.\d+)?/g) ?? []);
  const allowed = nums(evidenceText);
  return [...nums(text)].every((n) => allowed.has(n));
}
