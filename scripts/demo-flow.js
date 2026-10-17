// Reproducible two-session demo, printed as a narrative. Resets the demo learner, then:
//   Session 1: the learner repeats the mistakes (every answer wrong)
//   Memory update (Examiner -> Memory&Planner) -> Session 2: the Tutor reads the updated graph and targets differently
// Usage: npm run demo:flow     (needs FalkorDB; run `npm start` once, or any run of the app, to ingest resources first)
import { config } from '../server/config.js';
import { GraphClient } from '../server/graph/client.js';
import { ensureSchema } from '../server/graph/schema.js';
import { CatalogStore } from '../server/graph/catalog.js';
import { MemoryStore } from '../server/graph/memory.js';
import { LearningService } from '../server/services/learning.js';
import { ingestResources } from '../server/ingestion/ingest.js';
import { seedDemo } from '../server/seed/demo.js';

const L = 'learner:demo';
const client = await new GraphClient(config.falkor).connect();
await ensureSchema(client);
const catalog = new CatalogStore(client), memory = new MemoryStore(client);
const svc = new LearningService({ client, catalog, memory });
await ingestResources({ catalog, client, dir: config.resourcesDir });
await svc.ensureLearners();
await seedDemo({ service: svc, memory });

const line = (s = '') => console.log(s);
const show = (title, rec) => {
  line(`  ${title}: [${rec.activity}] ${rec.focusName}`);
  line(`    reason  : ${rec.reason}`);
  line(`    evidence: ${rec.evidence.mistakeCount} mistake(s) in ${rec.evidence.sessionCount} session(s) — ${rec.evidence.demoMistakes} from seeded DEMO history, ${rec.evidence.liveMistakes} from live answers; mastery ${rec.evidence.mastery}`);
};

line('=== Before any live activity (history is pre-seeded DEMO data) ===');
show('Recommendation', (await svc.tutor.brief({ learnerId: L })).recommendation);

async function run(name, sessionId, chooseWrong) {
  line(`\n=== ${name} ===`);
  const s = await svc.startSession(L, sessionId);
  line(`  Tutor said: ${s.briefing.explanation.text}`);
  for (const ex of s.exercises) {
    const full = await memory.getExercise(ex.id);
    const answer = chooseWrong ? (full.choices?.find((c) => c !== full.answer) ?? 'zzz') : full.answer;
    const r = await svc.answer({ learnerId: L, sessionId, exerciseId: ex.id, answer });
    line(`  ${ex.prompt.padEnd(28)} (${ex.reason}) → ${r.result.correct ? 'correct' : 'WRONG'}; ${r.result.conceptId}: mastery ${r.result.masteryBefore} → ${r.result.masteryAfter} (${r.result.status})`);
  }
  const done = await svc.complete({ learnerId: L, sessionId });
  line(`  Score ${done.score}%. Procedural memory: ${done.procedural.join(', ') || '(not enough evidence yet)'}`);
  show('Next recommendation', done.next.recommendation);
  line('  Agent handoffs:');
  for (const e of await memory.events(L, { sessionId, limit: 100 })) line(`    ${e.agent.padEnd(14)} ${e.action}`);
}

await run('SESSION 1 — the learner repeats the mistakes', 'demo-flow-1', true);
await run('SESSION 2 — the Tutor now reads the updated memory', 'demo-flow-2', false);
line('\nDone. Open the app → Memory to inspect the same nodes (AgentEvent, Recommendation, Mistake, STUDIES) in the graph.');
await client.close();
