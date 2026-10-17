// Integration-test harness: a throwaway graph on a real FalkorDB (FALKORDB_HOST / FALKORDB_PORT).
import { randomBytes } from 'node:crypto';
import { config } from '../server/config.js';
import { GraphClient } from '../server/graph/client.js';
import { ensureSchema } from '../server/graph/schema.js';
import { CatalogStore } from '../server/graph/catalog.js';
import { MemoryStore } from '../server/graph/memory.js';
import { LearningService } from '../server/services/learning.js';
import { RagService } from '../server/services/rag.js';
import { ingestResources } from '../server/ingestion/ingest.js';
import { seedDemo } from '../server/seed/demo.js';

export async function tryConnect() {
  const client = new GraphClient({ ...config.falkor, graph: `test_${randomBytes(4).toString('hex')}` });
  try { await client.connect({ retries: 1, delayMs: 100 }); return client; } catch { return null; }
}

export async function bootstrap(client, { seed = true } = {}) {
  await ensureSchema(client);
  const catalog = new CatalogStore(client);
  const memory = new MemoryStore(client);
  const service = new LearningService({ client, catalog, memory });
  const report = await ingestResources({ catalog, client, dir: config.resourcesDir });
  await service.ensureLearners();
  if (seed) await seedDemo({ service, memory });
  return { client, catalog, memory, service, report, rag: new RagService({ catalog, client }) };
}

export const teardown = async (client) => { try { await client.graph.delete(); } catch { /* ignore */ } await client.close(); };
