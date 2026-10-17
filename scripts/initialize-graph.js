// Creates indexes/constraints. Safe to run any number of times.
import { config } from '../server/config.js';
import { GraphClient } from '../server/graph/client.js';
import { ensureSchema } from '../server/graph/schema.js';

const client = await new GraphClient(config.falkor).connect();
const created = await ensureSchema(client);
console.log(created.length ? `Created ${created.length} schema objects:\n  ${created.join('\n  ')}` : 'Schema already up to date.');
await client.close();
