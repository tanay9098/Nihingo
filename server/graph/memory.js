// Memory store: everything the agents remember about a learner, persisted in FalkorDB.
//   episodic   -> LearningSession, Attempt, Mistake, ListeningLog, AgentEvent
//   semantic   -> (Learner)-[:STUDIES {mastery,...}]->(Concept), Recommendation evidence
//   procedural -> LearningPreference
import { KINDS, kindOfLabels } from './catalog.js';

const safeJson = (v, fallback) => { try { return JSON.parse(v); } catch { return fallback; } };

export class MemoryStore {
  constructor(client) { this.c = client; }

  // ---------- learner ----------
  async ensureLearner({ id, name, isDemo = false }) {
    await this.c.query(
      `MERGE (l:Learner {id: $id})
       ON CREATE SET l.createdAt = $now, l.memoryVersion = 0
       SET l.name = $name, l.isDemo = $isDemo`,
      { id, name, isDemo, now: Date.now() },
    );
  }

  async getLearner(id) {
    const r = await this.c.query(
      'MATCH (l:Learner {id: $id}) RETURN l.id AS id, l.name AS name, l.isDemo AS isDemo, l.createdAt AS createdAt, l.memoryVersion AS memoryVersion',
      { id },
    );
    return r[0] ?? null;
  }

  async bumpMemoryVersion(id) {
    const r = await this.c.query(
      'MATCH (l:Learner {id: $id}) SET l.memoryVersion = coalesce(l.memoryVersion, 0) + 1 RETURN l.memoryVersion AS v',
      { id },
    );
    return r[0]?.v ?? 0;
  }

  async resetLearner(id) {
    await this.c.query('MATCH (n) WHERE n.learnerId = $id DETACH DELETE n', { id });
    await this.c.query('MATCH (:Learner {id: $id})-[r:STUDIES|SAVED]->() DELETE r', { id });
    await this.c.query('MATCH (l:Learner {id: $id}) SET l.memoryVersion = 0', { id });
  }

  /** Removes a learner and everything recorded for it. */
  async deleteLearner(id) {
    await this.resetLearner(id);
    await this.c.query('MATCH (l:Learner {id: $id}) DETACH DELETE l', { id });
  }

  // ---------- accounts / sign-in sessions ----------
  // Account and AuthSession point at their learner through `profileId`, not `learnerId`: resetting a learner deletes every
  // node whose learnerId matches, and that must never take the account or its sign-ins with it.

  /** Creates the account and its own new Learner in one query. Returns false if the email is already registered. */
  async createAccount({ id, email, passwordHash, profileId, name, now }) {
    const r = await this.c.query(
      `OPTIONAL MATCH (x:Account {email: $email})
       WITH x WHERE x IS NULL
       CREATE (a:Account {id: $id, email: $email, passwordHash: $passwordHash, profileId: $profileId, createdAt: $now})
       CREATE (l:Learner {id: $profileId, name: $name, isDemo: false, createdAt: $now, memoryVersion: 0})
       RETURN a.id AS id`,
      { id, email, passwordHash, profileId, name, now },
    );
    return r.length === 1;
  }

  async getAccountByEmail(email) {
    const r = await this.c.query(
      'MATCH (a:Account {email: $email}) RETURN a.id AS id, a.email AS email, a.passwordHash AS passwordHash, a.profileId AS profileId',
      { email },
    );
    return r[0] ?? null;
  }

  async createAuthSession({ id, accountId, profileId, createdAt, expiresAt }) {
    await this.c.query(
      'CREATE (:AuthSession {id: $id, accountId: $accountId, profileId: $profileId, createdAt: $createdAt, expiresAt: $expiresAt})',
      { id, accountId, profileId, createdAt, expiresAt },
    );
  }

  async getAuthSession(id) {
    const r = await this.c.query(
      `MATCH (s:AuthSession {id: $id}) OPTIONAL MATCH (a:Account {id: s.accountId})
       RETURN s.id AS id, s.accountId AS accountId, s.profileId AS profileId, s.expiresAt AS expiresAt, a.email AS email`,
      { id },
    );
    return r[0] ?? null;
  }

  async deleteAuthSession(id) {
    await this.c.query('MATCH (s:AuthSession {id: $id}) DELETE s', { id });
  }

  async pruneAuthSessions(now) {
    const r = await this.c.query('MATCH (s:AuthSession) WHERE s.expiresAt <= $now DELETE s RETURN count(s) AS n', { now });
    return r[0]?.n ?? 0;
  }

  // ---------- sessions / attempts (episodic) ----------
  async createSession(s) {
    await this.c.query(
      `MATCH (l:Learner {id: $learnerId})
       MERGE (s:LearningSession {id: $id})
       ON CREATE SET s.learnerId = $learnerId, s.startedAt = $startedAt, s.isDemo = $isDemo, s.status = $status,
                     s.focus = $focus, s.mode = $mode, s.total = $total, s.recommendationId = $recId
       MERGE (l)-[:PARTICIPATED_IN]->(s)`,
      { id: s.id, learnerId: s.learnerId, startedAt: s.startedAt, isDemo: !!s.isDemo, status: s.status ?? 'active', focus: s.focus ?? '', mode: s.mode ?? 'demo', total: s.exerciseIds.length, recId: s.recommendationId ?? '' },
    );
    await this.c.query(
      `UNWIND $items AS it
       MATCH (s:LearningSession {id: $sid}), (e:Exercise {id: it.id})
       MERGE (s)-[x:SELECTED]->(e) SET x.position = it.position`,
      { sid: s.id, items: s.exerciseIds.map((id, position) => ({ id, position })) },
    );
  }

  async getSession(id) {
    const r = await this.c.query(
      `MATCH (s:LearningSession {id: $id})
       RETURN s.id AS id, s.learnerId AS learnerId, s.status AS status, s.startedAt AS startedAt, s.endedAt AS endedAt,
              s.isDemo AS isDemo, s.focus AS focus, s.total AS total, s.score AS score, s.recommendationId AS recommendationId`,
      { id },
    );
    return r[0] ?? null;
  }

  async sessionExerciseIds(sid) {
    const r = await this.c.query(
      'MATCH (:LearningSession {id: $sid})-[x:SELECTED]->(e:Exercise) RETURN e.id AS id ORDER BY x.position', { sid },
    );
    return r.map((x) => x.id);
  }

  async completeSession(id, { endedAt, score }) {
    await this.c.query(
      "MATCH (s:LearningSession {id: $id}) SET s.status = 'completed', s.endedAt = $endedAt, s.score = $score",
      { id, endedAt, score },
    );
  }

  async recentSessions(learnerId, limit = 6) {
    return this.c.read(
      `MATCH (:Learner {id: $lid})-[:PARTICIPATED_IN]->(s:LearningSession)
       OPTIONAL MATCH (s)-[:INCLUDES]->(a:Attempt)
       WITH s, count(a) AS attempts, sum(CASE WHEN a.correct THEN 1 ELSE 0 END) AS correct
       RETURN s.id AS id, s.startedAt AS startedAt, s.endedAt AS endedAt, s.status AS status, s.isDemo AS isDemo,
              s.focus AS focus, attempts, correct, s.total AS total
       ORDER BY s.startedAt DESC LIMIT $limit`,
      { lid: learnerId, limit },
    );
  }

  async getAttempt(id) {
    const r = await this.c.query(
      `MATCH (a:Attempt {id: $id})
       RETURN a.id AS id, a.sessionId AS sessionId, a.exerciseId AS exerciseId, a.correct AS correct, a.ambiguous AS ambiguous,
              a.answer AS answer, a.expected AS expected, a.feedback AS feedback, a.masteryBefore AS masteryBefore,
              a.masteryAfter AS masteryAfter, a.statusAfter AS statusAfter, a.conceptId AS conceptId, a.learnerId AS learnerId,
              a.explanation AS explanation, a.isDemo AS isDemo`,
      { id },
    );
    return r[0] ?? null;
  }

  async getExercise(id) {
    const r = await this.c.query(
      `MATCH (e:Exercise {id: $id})-[:TESTS]->(c:Concept)
       RETURN e AS node, collect(c.id) AS conceptIds, collect(coalesce(c.name, c.word, c.char)) AS conceptNames`,
      { id },
    );
    if (!r.length || !r[0].node) return null;
    const e = r[0].node.properties;
    return {
      ...e,
      choices: e.choices ? safeJson(e.choices, null) : null,
      accept: e.accept ? safeJson(e.accept, []) : [],
      alsoValid: e.alsoValid ? safeJson(e.alsoValid, []) : [],
      conceptIds: r[0].conceptIds, conceptNames: r[0].conceptNames,
    };
  }

  async exercisesForConcepts(conceptIds) {
    const r = await this.c.query(
      `MATCH (e:Exercise)-[:TESTS]->(c:Concept) WHERE c.id IN $ids
       RETURN e.id AS id, e.type AS type, e.format AS format, e.origin AS origin, c.id AS conceptId ORDER BY e.id`,
      { ids: conceptIds },
    );
    return r;
  }

  async getStudyStates(learnerId, conceptIds) {
    const r = await this.c.query(
      `MATCH (:Learner {id: $lid})-[s:STUDIES]->(c:Concept) WHERE c.id IN $ids
       RETURN c.id AS id, s.attempts AS attempts, s.correct AS correct, s.mistakes AS mistakes, s.recent AS recent,
              s.intervalDays AS intervalDays, s.ease AS ease, s.mastery AS mastery, s.status AS status,
              s.lastSeen AS lastSeen, s.dueAt AS dueAt`,
      { lid: learnerId, ids: conceptIds },
    );
    return Object.fromEntries(r.map((x) => [x.id, x]));
  }

  /** Persist one graded attempt, its (optional) mistake and the updated STUDIES edge. */
  async writeAttempt({ attempt, mistake, studies }) {
    await this.c.query(
      `MATCH (l:Learner {id: $a.learnerId}), (s:LearningSession {id: $a.sessionId}), (e:Exercise {id: $a.exerciseId})
       MERGE (at:Attempt {id: $a.id})
       ON CREATE SET at += $a
       MERGE (l)-[:ATTEMPTED]->(at)
       MERGE (s)-[:INCLUDES]->(at)
       MERGE (at)-[:OF]->(e)`,
      { a: attempt },
    );
    await this.c.query(
      `UNWIND $studies AS st
       MATCH (at:Attempt {id: $aid}), (c:Concept {id: st.conceptId})
       MERGE (at)-[:TESTED]->(c)
       WITH at, c, st
       MATCH (l:Learner {id: $lid})
       MERGE (l)-[r:STUDIES]->(c)
       SET r += st.state`,
      { aid: attempt.id, lid: attempt.learnerId, studies },
    );
    if (mistake) {
      await this.c.query(
        `MATCH (at:Attempt {id: $aid}), (c:Concept {id: $m.conceptId})
         MERGE (m:Mistake {id: $m.id}) ON CREATE SET m += $m
         MERGE (at)-[:RESULTED_IN]->(m)
         MERGE (m)-[:ABOUT]->(c)`,
        { aid: attempt.id, m: mistake },
      );
    }
  }

  // ---------- semantic memory queries ----------
  async recurringMistakes(learnerId, minMistakes = 1) {
    const rows = await this.c.query(
      `MATCH (m:Mistake {learnerId: $lid})-[:ABOUT]->(c:Concept)
       OPTIONAL MATCH (s:LearningSession)-[:INCLUDES]->(:Attempt)-[:RESULTED_IN]->(m)
       OPTIONAL MATCH (:Learner {id: $lid})-[st:STUDIES]->(c)
       WITH c, st, count(DISTINCT m) AS mistakes, count(DISTINCT s) AS sessions, max(m.at) AS lastAt,
            collect(DISTINCT m.id)[0..5] AS mistakeIds, sum(CASE WHEN m.isDemo THEN 1 ELSE 0 END) AS demoMistakes
       WHERE mistakes >= $min
       RETURN c.id AS id, labels(c) AS labels, coalesce(c.name, c.word, c.char) AS name, mistakes, sessions, lastAt,
              mistakeIds, demoMistakes, st.status AS status, st.mastery AS mastery, st.recent AS recent
       ORDER BY mistakes DESC, lastAt DESC`,
      { lid: learnerId, min: minMistakes },
    );
    return rows.map((r) => ({ ...r, kind: kindOfLabels(r.labels) }));
  }

  async recentMistakes(learnerId, limit = 8) {
    const rows = await this.c.read(
      `MATCH (m:Mistake {learnerId: $lid})-[:ABOUT]->(c:Concept)
       RETURN m.id AS id, m.at AS at, m.given AS given, m.expected AS expected, m.prompt AS prompt, m.isDemo AS isDemo,
              c.id AS conceptId, coalesce(c.name, c.word, c.char) AS concept, labels(c) AS labels
       ORDER BY m.at DESC LIMIT $limit`,
      { lid: learnerId, limit },
    );
    return rows.map((r) => ({ ...r, kind: kindOfLabels(r.labels) }));
  }

  async dueItems(learnerId, now, limit = 10) {
    const rows = await this.c.read(
      `MATCH (:Learner {id: $lid})-[s:STUDIES]->(c:Concept)
       WHERE s.dueAt <= $now
       RETURN c.id AS id, labels(c) AS labels, coalesce(c.name, c.word, c.char) AS name, s.dueAt AS dueAt,
              s.mastery AS mastery, s.status AS status, s.attempts AS attempts
       ORDER BY s.dueAt ASC LIMIT $limit`,
      { lid: learnerId, now, limit },
    );
    return rows.map((r) => ({ ...r, kind: kindOfLabels(r.labels) }));
  }

  async progress(learnerId) {
    const out = {};
    for (const [kind, label] of Object.entries(KINDS)) {
      const r = await this.c.read(
        `MATCH (c:${label})
         OPTIONAL MATCH (:Learner {id: $lid})-[s:STUDIES]->(c)
         RETURN count(c) AS total, count(s) AS studied,
                sum(CASE WHEN s.status = 'mastered' THEN 1 ELSE 0 END) AS mastered,
                sum(CASE WHEN s.status = 'struggling' THEN 1 ELSE 0 END) AS struggling`,
        { lid: learnerId },
      );
      out[kind] = r[0];
    }
    return out;
  }

  async studyList(learnerId, limit = 60) {
    const rows = await this.c.read(
      `MATCH (:Learner {id: $lid})-[s:STUDIES]->(c:Concept)
       RETURN c.id AS id, labels(c) AS labels, coalesce(c.name, c.word, c.char) AS name, s.mastery AS mastery,
              s.status AS status, s.attempts AS attempts, s.mistakes AS mistakes, s.dueAt AS dueAt, s.lastSeen AS lastSeen
       ORDER BY s.lastSeen DESC LIMIT $limit`,
      { lid: learnerId, limit },
    );
    return rows.map((r) => ({ ...r, kind: kindOfLabels(r.labels) }));
  }

  async prerequisites(learnerId, conceptId) {
    return this.c.query(
      `MATCH (:Concept {id: $id})-[:REQUIRES]->(p:Concept)
       OPTIONAL MATCH (:Learner {id: $lid})-[s:STUDIES]->(p)
       RETURN p.id AS id, p.name AS name, s.mastery AS mastery, s.status AS status, s.attempts AS attempts`,
      { lid: learnerId, id: conceptId },
    );
  }

  async contrastPartners(conceptId) {
    return this.c.query(
      'MATCH (:Concept {id: $id})-[:CONTRASTS_WITH]-(p:Concept) RETURN DISTINCT p.id AS id, p.name AS name',
      { id: conceptId },
    );
  }

  /** Grammar concepts never studied whose prerequisites have all been attempted at least once. */
  async nextGrammar(learnerId, limit = 3) {
    const rows = await this.c.query(
      `MATCH (g:GrammarConcept)
       WHERE NOT (:Learner {id: $lid})-[:STUDIES]->(g)
       OPTIONAL MATCH (g)-[:REQUIRES]->(p:Concept)
       OPTIONAL MATCH (:Learner {id: $lid})-[ps:STUDIES]->(p)
       WITH g, collect(CASE WHEN p IS NULL THEN 1 ELSE coalesce(ps.attempts, 0) END) AS preq
       RETURN g.id AS id, g.name AS name, g.order AS ord, preq
       ORDER BY ord`,
      { lid: learnerId },
    );
    return rows.filter((r) => r.preq.every((n) => n > 0)).slice(0, limit);
  }

  async nextVocabulary(learnerId, limit = 5) {
    return this.c.query(
      `MATCH (v:Vocabulary) WHERE NOT (:Learner {id: $lid})-[:STUDIES]->(v)
       RETURN v.id AS id, v.word AS name, v.order AS ord ORDER BY ord LIMIT $limit`,
      { lid: learnerId, limit },
    );
  }

  /** Per learning-path step: how many items exist, how many this learner has introduced/mastered, and a preview. */
  async pathwayProgress(learnerId, steps) {
    const out = {};
    for (const s of steps) {
      const [r] = await this.c.read(
        `MATCH (c:${s.label}) WHERE ${s.where}
         OPTIONAL MATCH (:Learner {id: $lid})-[st:STUDIES]->(c)
         RETURN count(c) AS total, count(st) AS studied, sum(CASE WHEN st.status = 'mastered' THEN 1 ELSE 0 END) AS mastered`,
        { lid: learnerId },
      );
      const preview = r.total ? await this.c.read(
        `MATCH (c:${s.label}) WHERE ${s.where} RETURN coalesce(c.name, c.word, c.char) AS name ORDER BY c.order LIMIT 4`,
      ) : [];
      out[s.id] = { ...r, preview: preview.map((p) => p.name) };
    }
    return out;
  }

  /** Items of one learning-path step this learner has not studied yet, in source order. */
  async nextInStep(learnerId, step, limit = 3) {
    return this.c.query(
      `MATCH (c:${step.label}) WHERE ${step.where} AND NOT (:Learner {id: $lid})-[:STUDIES]->(c)
       RETURN c.id AS id, coalesce(c.name, c.word, c.char) AS name, c.order AS ord ORDER BY ord LIMIT $limit`,
      { lid: learnerId, limit },
    );
  }

  async conceptTopics(conceptIds) {
    return this.c.query(
      'MATCH (c:Concept)-[:TAGGED]->(t:Topic) WHERE c.id IN $ids RETURN DISTINCT c.id AS conceptId, t.id AS topicId, t.name AS topic',
      { ids: conceptIds },
    );
  }

  async conceptsForTopic(topicId, learnerId, limit = 6) {
    return this.c.query(
      `MATCH (c:Concept)-[:TAGGED]->(:Topic {id: $tid})
       OPTIONAL MATCH (:Learner {id: $lid})-[s:STUDIES]->(c)
       RETURN c.id AS id, coalesce(c.name, c.word, c.char) AS name, coalesce(s.mastery, 0) AS mastery, s.status AS status
       ORDER BY mastery ASC, id LIMIT $limit`,
      { tid: topicId, lid: learnerId, limit },
    );
  }

  /** Listening lessons ranked by topic overlap with the given topics, preferring unwatched ones. */
  async lessonsForTopics(learnerId, topicIds, limit = 3) {
    return this.c.query(
      `MATCH (l:Lesson)
       OPTIONAL MATCH (l)-[:TAGGED]->(t:Topic) WHERE t.id IN $tids
       WITH l, collect(t.name) AS shared
       OPTIONAL MATCH (g:ListeningLog {learnerId: $lid})-[:OF]->(l)
       WITH l, shared, count(g) AS watched
       RETURN l.id AS id, l.videoId AS videoId, l.title AS title, l.published AS published, l.difficulty AS difficulty,
              shared, size(shared) AS overlap, watched
       ORDER BY overlap DESC, watched ASC, l.published DESC LIMIT $limit`,
      { lid: learnerId, tids: topicIds, limit },
    );
  }

  async lowListeningRatings(learnerId, maxRating = 2) {
    return this.c.query(
      `MATCH (g:ListeningLog {learnerId: $lid})-[:OF]->(l:Lesson)
       WHERE g.rating <= $max
       OPTIONAL MATCH (l)-[:TAGGED]->(t:Topic)
       RETURN g.id AS logId, g.at AS at, g.rating AS rating, l.id AS lessonId, l.title AS title,
              collect(t.id) AS topicIds, collect(t.name) AS topics
       ORDER BY at DESC LIMIT 3`,
      { lid: learnerId, max: maxRating },
    );
  }

  // ---------- listening ----------
  /** Idempotent per log id. Returns false (and writes nothing) if the id already belongs to another learner. */
  async logListening({ id, learnerId, lessonId, rating, note, at, isDemo }) {
    const r = await this.c.query(
      `MATCH (l:Learner {id: $learnerId}), (le:Lesson {id: $lessonId})
       OPTIONAL MATCH (prev:ListeningLog {id: $id})
       WITH l, le, prev WHERE prev IS NULL OR prev.learnerId = $learnerId
       MERGE (g:ListeningLog {id: $id})
       ON CREATE SET g.learnerId = $learnerId, g.at = $at, g.rating = $rating, g.note = $note, g.isDemo = $isDemo
       MERGE (l)-[:WATCHED]->(g)
       MERGE (g)-[:OF]->(le)
       RETURN g.id AS id`,
      { id, learnerId, lessonId, rating, note: note ?? '', at, isDemo: !!isDemo },
    );
    return r.length > 0;
  }

  async setSaved(learnerId, lessonId, saved) {
    if (saved) {
      await this.c.query(
        'MATCH (l:Learner {id: $lid}), (le:Lesson {id: $id}) MERGE (l)-[s:SAVED]->(le) ON CREATE SET s.at = $now',
        { lid: learnerId, id: lessonId, now: Date.now() },
      );
    } else {
      await this.c.query('MATCH (:Learner {id: $lid})-[s:SAVED]->(:Lesson {id: $id}) DELETE s', { lid: learnerId, id: lessonId });
    }
  }

  async listeningLogs(learnerId, limit = 20) {
    return this.c.read(
      `MATCH (g:ListeningLog {learnerId: $lid})-[:OF]->(l:Lesson)
       RETURN g.id AS id, g.at AS at, g.rating AS rating, g.note AS note, g.isDemo AS isDemo, l.id AS lessonId, l.title AS title
       ORDER BY g.at DESC LIMIT $limit`,
      { lid: learnerId, limit },
    );
  }

  // ---------- procedural memory ----------
  async upsertPreference({ learnerId, key, value, source, evidenceCount = 0, evidence = '' }) {
    await this.c.query(
      `MATCH (l:Learner {id: $learnerId})
       MERGE (p:LearningPreference {id: $id})
       SET p.learnerId = $learnerId, p.key = $key, p.value = $value, p.source = $source,
           p.evidenceCount = $evidenceCount, p.evidence = $evidence, p.updatedAt = $now
       MERGE (l)-[:PREFERS]->(p)`,
      { id: `pref:${learnerId}:${key}`, learnerId, key, value: String(value), source, evidenceCount, evidence, now: Date.now() },
    );
  }

  async deletePreference(learnerId, key) {
    await this.c.query('MATCH (p:LearningPreference {id: $id}) DETACH DELETE p', { id: `pref:${learnerId}:${key}` });
  }

  async preferences(learnerId) {
    return this.c.query(
      `MATCH (:Learner {id: $lid})-[:PREFERS]->(p:LearningPreference)
       RETURN p.key AS key, p.value AS value, p.source AS source, p.evidenceCount AS evidenceCount,
              p.evidence AS evidence, p.updatedAt AS updatedAt ORDER BY key`,
      { lid: learnerId },
    );
  }

  async formatStats(learnerId) {
    const rows = await this.c.query(
      `MATCH (a:Attempt {learnerId: $lid}) WHERE a.format IS NOT NULL
       RETURN a.format AS format, count(a) AS attempts, sum(CASE WHEN a.correct THEN 1 ELSE 0 END) AS correct`,
      { lid: learnerId },
    );
    return Object.fromEntries(rows.map((r) => [r.format, { attempts: r.attempts, correct: r.correct }]));
  }

  // ---------- recommendations ----------
  async saveRecommendation(rec) {
    await this.c.query(
      `MATCH (l:Learner {id: $rec.learnerId})
       MERGE (r:Recommendation {id: $rec.id})
       ON CREATE SET r += $rec
       SET r.status = 'active'
       MERGE (l)-[:HAS_RECOMMENDATION]->(r)`,
      { rec },
    );
    const links = rec.targets.map((t) => ({ id: t }));
    await this.c.query(
      `UNWIND $links AS t
       MATCH (r:Recommendation {id: $rid})
       MATCH (n {id: t.id}) WHERE n:Concept OR n:Lesson
       MERGE (r)-[:RECOMMENDS]->(n)`,
      { rid: rec.id, links },
    );
    if (rec.basedOn.length) {
      await this.c.query(
        `UNWIND $ids AS mid
         MATCH (r:Recommendation {id: $rid}), (m {id: mid}) WHERE m:Mistake OR m:Attempt OR m:ListeningLog
         MERGE (r)-[:BASED_ON]->(m)`,
        { rid: rec.id, ids: rec.basedOn },
      );
    }
  }

  async latestRecommendations(learnerId) {
    const rows = await this.c.query(
      `MATCH (r:Recommendation {learnerId: $lid, status: 'active'})
       RETURN r.id AS id, r.activity AS activity, r.role AS role, r.focusId AS focusId, r.focusName AS focusName,
              r.reason AS reason, r.evidence AS evidence, r.stateVersion AS stateVersion, r.createdAt AS createdAt,
              r.agent AS agent, r.isDemoBasis AS isDemoBasis
       ORDER BY r.role`,
      { lid: learnerId },
    );
    return rows.map((r) => ({ ...r, evidence: safeJson(r.evidence, {}) }));
  }

  async attachExercises(sid, { exerciseIds, focus, recommendationId }) {
    await this.c.query(
      "MATCH (s:LearningSession {id: $sid}) SET s.total = $total, s.focus = $focus, s.recommendationId = $rec, s.status = 'active'",
      { sid, total: exerciseIds.length, focus: focus ?? '', rec: recommendationId ?? '' },
    );
    await this.c.query(
      `UNWIND $items AS it
       MATCH (s:LearningSession {id: $sid}), (e:Exercise {id: it.id})
       MERGE (s)-[x:SELECTED]->(e) SET x.position = it.position, x.reason = it.reason`,
      { sid, items: exerciseIds.map((it, position) => ({ id: it.id, reason: it.reason ?? '', position })) },
    );
  }

  async recentExerciseIds(learnerId, limit = 40) {
    const r = await this.c.query(
      'MATCH (a:Attempt {learnerId: $lid}) RETURN a.exerciseId AS id ORDER BY a.at DESC LIMIT $limit', { lid: learnerId, limit },
    );
    return r.map((x) => x.id);
  }

  async lastEventId(sessionId) {
    const r = await this.c.query(
      'MATCH (:LearningSession {id: $sid})-[:LOGGED]->(e:AgentEvent) RETURN e.id AS id ORDER BY e.at DESC, e.seq DESC LIMIT 1',
      { sid: sessionId },
    );
    return r[0]?.id ?? '';
  }

  // ---------- agent events ----------
  async logEvent(ev) {
    await this.c.query(
      `MATCH (l:Learner {id: $ev.learnerId})
       MERGE (e:AgentEvent {id: $ev.id})
       ON CREATE SET e += $ev
       MERGE (l)-[:HAS_EVENT]->(e)`,
      { ev },
    );
    if (ev.sessionId) {
      await this.c.query(
        'MATCH (s:LearningSession {id: $sid}), (e:AgentEvent {id: $id}) MERGE (s)-[:LOGGED]->(e)',
        { sid: ev.sessionId, id: ev.id },
      );
    }
    if (ev.prevId) {
      await this.c.query(
        'MATCH (p:AgentEvent {id: $prev}), (e:AgentEvent {id: $id}) MERGE (p)-[h:HANDED_OFF_TO]->(e) SET h.via = $via',
        { prev: ev.prevId, id: ev.id, via: ev.handoff ?? '' },
      );
    }
  }

  async events(learnerId, { limit = 40, sessionId = '' } = {}) {
    const rows = sessionId
      ? await this.c.read(
        `MATCH (:LearningSession {id: $sid})-[:LOGGED]->(e:AgentEvent) WHERE e.learnerId = $lid
         OPTIONAL MATCH (p:AgentEvent)-[:HANDED_OFF_TO]->(e)
         RETURN e.id AS id, e.agent AS agent, e.action AS action, e.retrieved AS retrieved, e.changed AS changed,
                e.output AS output, e.at AS at, e.seq AS seq, e.sessionId AS sessionId, e.isDemo AS isDemo, p.id AS handoffFrom
         ORDER BY e.at, e.seq LIMIT $limit`,
        { sid: sessionId, lid: learnerId, limit },
      )
      : await this.c.read(
        `MATCH (:Learner {id: $lid})-[:HAS_EVENT]->(e:AgentEvent)
         OPTIONAL MATCH (p:AgentEvent)-[:HANDED_OFF_TO]->(e)
         RETURN e.id AS id, e.agent AS agent, e.action AS action, e.retrieved AS retrieved, e.changed AS changed,
                e.output AS output, e.at AS at, e.seq AS seq, e.sessionId AS sessionId, e.isDemo AS isDemo, p.id AS handoffFrom
         ORDER BY e.at DESC, e.seq DESC LIMIT $limit`,
        { lid: learnerId, limit },
      );
    return rows.map((e) => ({
      ...e, retrieved: safeJson(e.retrieved, {}), changed: safeJson(e.changed, {}), output: safeJson(e.output, {}),
    }));
  }

  // ---------- bounded graph exploration ----------
  /** Neighbours of one node as seen by `viewer`: other learners and anything they own are left out. */
  async neighborhood(centerId, { limit = 40, exclude = [], viewer } = {}) {
    const rows = await this.c.read(
      `MATCH (c {id: $id})-[r]-(n)
       WHERE NOT any(l IN labels(n) WHERE l IN $exclude)
         AND NOT (n:Learner AND n.id <> $viewer)
         AND (n.learnerId IS NULL OR n.learnerId = $viewer)
       RETURN c AS center, labels(c) AS clabels, type(r) AS rel, startNode(r).id = $id AS outgoing,
              n.id AS id, labels(n) AS labels, coalesce(n.name, n.word, n.char, n.title, n.key, n.prompt, n.activity, n.id) AS name,
              n.status AS status, n.mastery AS mastery, r.mastery AS rMastery, r.status AS rStatus
       LIMIT $limit`,
      { id: centerId, limit, exclude, viewer },
    );
    return rows;
  }
}
