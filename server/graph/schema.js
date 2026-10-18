// Graph schema: labels, indexes and uniqueness constraints. Safe to run repeatedly.
export const SCHEMA_VERSION = 2;

// Every label that is looked up by `id` gets a range index and a UNIQUE constraint.
export const ID_LABELS = [
  'Concept', 'Vocabulary', 'Kanji', 'Kana', 'GrammarConcept', 'Exercise', 'Resource', 'Lesson', 'Topic',
  'Learner', 'LearningSession', 'Attempt', 'Mistake', 'Recommendation', 'LearningPreference',
  'AgentEvent', 'ListeningLog', 'Account', 'AuthSession',
];

const isExists = (err) => /already (indexed|exists)|already been|exists/i.test(err?.message || '');

export async function ensureSchema(client) {
  const g = client.graph;
  const created = [];
  for (const label of ID_LABELS) {
    try { await g.createNodeRangeIndex(label, 'id'); created.push(`index:${label}.id`); } catch (e) { if (!isExists(e)) throw e; }
  }
  // Secondary indexes used by the heaviest queries.
  const extra = [['Attempt', 'learnerId'], ['Mistake', 'learnerId'], ['AgentEvent', 'learnerId'], ['LearningSession', 'learnerId'], ['Account', 'email']];
  for (const [label, prop] of extra) {
    try { await g.createNodeRangeIndex(label, prop); created.push(`index:${label}.${prop}`); } catch (e) { if (!isExists(e)) throw e; }
  }
  for (const label of ID_LABELS) {
    try { await g.constraintCreate('UNIQUE', 'NODE', label, 'id'); created.push(`unique:${label}.id`); } catch (e) { if (!isExists(e)) throw e; }
  }
  // One account per email address, enforced by the database (not just by a read-then-write check).
  try { await g.constraintCreate('UNIQUE', 'NODE', 'Account', 'email'); created.push('unique:Account.email'); } catch (e) { if (!isExists(e)) throw e; }
  await client.query(
    'MERGE (m:Meta {id: $id}) SET m.schemaVersion = $v, m.updatedAt = $now',
    { id: 'schema', v: SCHEMA_VERSION, now: Date.now() },
  );
  return created;
}
