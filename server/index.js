import { config, appMode } from './config.js';
import { GraphClient } from './graph/client.js';
import { ensureSchema } from './graph/schema.js';
import { CatalogStore } from './graph/catalog.js';
import { MemoryStore } from './graph/memory.js';
import { LearningService } from './services/learning.js';
import { AuthService } from './services/auth.js';
import { RagService } from './services/rag.js';
import { ingestResources } from './ingestion/ingest.js';
import { seedDemo } from './seed/demo.js';
import { createApp } from './app.js';

const state = { ready: false, error: 'Connecting to FalkorDB…', bootstrap: null };
let services = null;

async function boot() {
  const client = await new GraphClient(config.falkor).connect({ retries: 60, delayMs: 1000 });
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
  services = { client, catalog, memory, service, auth: new AuthService({ memory }), rag: new RagService({ catalog, client }) };
  state.ready = true; state.error = null; state.bootstrap = info;
  console.log(`Ready. Mode: ${appMode()} · graph "${config.falkor.graph}" @ ${config.falkor.host}:${config.falkor.port}`);
}

const app = createApp({ get: async () => { if (!services) throw new Error('not ready'); return services; }, state: () => state });
const server = app.listen(config.port, () => console.log(`Nihongo Graph on http://localhost:${config.port} (mode: ${appMode()})`));

boot().catch((err) => { state.error = err.message; console.error('Bootstrap failed:', err.message); });

const stop = async () => { server.close(); await services?.client.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
