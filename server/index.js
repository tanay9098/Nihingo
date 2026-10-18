import { config, appMode } from './config.js';
import { GraphClient } from './graph/client.js';
import { ensureSchema } from './graph/schema.js';
import { CatalogStore } from './graph/catalog.js';
import { MemoryStore } from './graph/memory.js';
import { LearningService } from './services/learning.js';
import { AuthService } from './services/auth.js';
import { GoogleAuth } from './services/google.js';
import { RagService } from './services/rag.js';
import { ingestResources } from './ingestion/ingest.js';
import { seedDemo } from './seed/demo.js';
import { createApp } from './app.js';

const state = { ready: false, error: 'Connecting to FalkorDB…', bootstrap: null };
let services = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;

async function boot() {
  const client = await new GraphClient(config.falkor).connect({ retries: 10, delayMs: 1000 });
  try { await setUp(client); } catch (err) { await client.close(); throw err; }
}

async function setUp(client) {
  await ensureSchema(client);
  const catalog = new CatalogStore(client);
  const memory = new MemoryStore(client);
  const service = new LearningService({ client, catalog, memory });
  const info = {};
  if (config.autoBootstrap) {
    const report = await ingestResources({ catalog, client, dir: config.resourcesDir, log: (m) => console.log(m) });
    info.ingest = report.totals;
    await service.ensureLearners();
    const demo = await memory.recentSessions('learner:demo', 1);
    if (!demo.length) { await seedDemo({ service, memory, log: (m) => console.log(m) }); info.demoSeeded = true; }
  } else await service.ensureLearners();
  await memory.pruneAuthSessions(Date.now());
  await memory.pruneGuests();
  const google = new GoogleAuth(config.google);
  services = { client, catalog, memory, service, auth: new AuthService({ memory }), google, rag: new RagService({ catalog, client }) };
  state.ready = true; state.error = null; state.bootstrap = info;
  console.log(`Ready. Mode: ${appMode()} · graph "${config.falkor.graph}" @ ${config.falkor.host}:${config.falkor.port} · Google sign-in ${google.enabled ? 'on' : 'off'}`);
  // Expired sign-ins and abandoned guest accounts are cleaned up once a day as well as on boot.
  setInterval(() => memory.pruneAuthSessions(Date.now()).then(() => memory.pruneGuests()).catch((e) => console.error('Prune failed:', e.message)), DAY).unref();
}

// Keeps trying until the database is reachable, so a database that starts late (or after the app) is picked up without a restart.
async function bootLoop() {
  const local = ['localhost', '127.0.0.1'].includes(config.falkor.host);
  for (let attempt = 1; ; attempt++) {
    try { await boot(); return; } catch (err) {
      state.error = err.message;
      console.error(`Bootstrap failed (attempt ${attempt}): ${err.message}`);
      if (attempt === 1 && local && (process.env.RENDER || process.env.NODE_ENV === 'production')) {
        console.error('FALKORDB_HOST is localhost. On a hosting platform such as Render the database is not on the same machine: '
          + 'set FALKORDB_HOST/FALKORDB_PORT/FALKORDB_PASSWORD (and FALKORDB_TLS=1, FALKORDB_USERNAME for FalkorDB Cloud).');
      }
      await sleep(Math.min(60_000, 5000 * attempt));
    }
  }
}

const app = createApp({ get: async () => { if (!services) throw new Error('not ready'); return services; }, state: () => state });
const server = app.listen(config.port, () => console.log(`Nihongo Graph on http://localhost:${config.port} (mode: ${appMode()})`));

bootLoop();

const stop = async () => { server.close(); await services?.client.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
