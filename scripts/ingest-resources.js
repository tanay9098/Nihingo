// Scans resources/, ingests everything incrementally and refreshes the generated section of docs/RESOURCE_INVENTORY.md.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../server/config.js';
import { GraphClient } from '../server/graph/client.js';
import { ensureSchema } from '../server/graph/schema.js';
import { CatalogStore } from '../server/graph/catalog.js';
import { ingestResources } from '../server/ingestion/ingest.js';
import { renderInventory } from '../server/ingestion/inventory.js';

const force = process.argv.includes('--force');
const client = await new GraphClient(config.falkor).connect();
await ensureSchema(client);
const report = await ingestResources({ catalog: new CatalogStore(client), client, dir: config.resourcesDir, force, log: console.log });
console.log('Totals:', JSON.stringify(report.totals));

if (!process.argv.includes('--no-doc')) {
  const docPath = path.join(config.rootDir, 'docs', 'RESOURCE_INVENTORY.md');
  const doc = await readFile(docPath, 'utf8');
  const [begin, end] = ['<!-- BEGIN GENERATED -->', '<!-- END GENERATED -->'];
  const a = doc.indexOf(begin), b = doc.indexOf(end);
  if (a >= 0 && b > a) {
    await writeFile(docPath, doc.slice(0, a + begin.length) + '\n' + renderInventory(report) + '\n' + doc.slice(b));
    console.log('Updated docs/RESOURCE_INVENTORY.md');
  }
}
await client.close();
