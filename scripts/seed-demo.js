import { config } from '../server/config.js';
import { GraphClient } from '../server/graph/client.js';
import { CatalogStore } from '../server/graph/catalog.js';
import { MemoryStore } from '../server/graph/memory.js';
import { LearningService } from '../server/services/learning.js';
import { seedDemo } from '../server/seed/demo.js';

const client = await new GraphClient(config.falkor).connect();
const memory = new MemoryStore(client);
const service = new LearningService({ client, catalog: new CatalogStore(client), memory });
await service.ensureLearners();
await seedDemo({ service, memory, log: console.log });
await client.close();
