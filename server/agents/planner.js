// Agent 3 — Memory & Planner.
// Owns every write to learner memory: episodic (attempts, mistakes, sessions), semantic (STUDIES mastery
// edges, recommendations + evidence) and procedural (LearningPreference). It also decides what to study next.
import { createHash } from 'node:crypto';
import { updateStudyState, inferBestFormat, EMPTY_STATE } from './mastery.js';
import { formatOf } from './grade.js';
import { AgentLog } from './events.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const h = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);

// Per-learner mutex: attempts for one learner are applied strictly in order.
const chains = new Map();
export function withLock(key, fn) {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chains.set(key, next.finally(() => { if (chains.get(key) === next) chains.delete(key); }));
  return next;
}

export const DEFAULT_PREFS = { session_length: 5, preferred_format: 'any', include_listening: 'true', revision_pace: 'normal' };
export const PREF_RULES = {
  session_length: (v) => ['3', '5', '8'].includes(String(v)),
  preferred_format: (v) => ['any', 'multiple_choice', 'typed', 'flashcard'].includes(v),
  include_listening: (v) => ['true', 'false'].includes(String(v)),
  revision_pace: (v) => ['fast', 'normal', 'slow'].includes(v),
};

export function effectivePrefs(rows) {
  const p = { ...DEFAULT_PREFS };
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  for (const k of Object.keys(DEFAULT_PREFS)) if (byKey[k]) p[k] = byKey[k].value;
  p.session_length = Number(p.session_length);
  const inferred = byKey.inferred_format;
  p.format = p.preferred_format !== 'any' ? p.preferred_format : inferred?.value ?? null;
  p.formatSource = p.preferred_format !== 'any' ? 'explicit' : inferred ? 'inferred' : null;
  return p;
}

/** Pure recommendation policy. `ctx` is plain data read from the graph, so this is unit-testable. */
export function decide(ctx) {
  const { recurring, prereqs, contrasts, due, nextGrammar, nextVocab, lowListening, noHistory } = ctx;
  const live = (r) => !(r.recent?.endsWith('11') || r.status === 'mastered');
  const open = recurring.filter((r) => r.mistakes >= 2 && live(r))
    .sort((a, b) => (b.status === 'struggling') - (a.status === 'struggling') || b.mistakes - a.mistakes || b.lastAt - a.lastAt);

  if (open.length) {
    const top = open[0];
    const weak = (prereqs[top.id] || []).filter((p) => !p.attempts || (p.mastery ?? 0) < 0.35);
    if (weak.length && top.kind === 'grammar') {
      const p = weak[0];
      return {
        activity: 'revise_prerequisite', focus: [{ id: p.id, name: p.name }], rule: 'prerequisite-gap', primary: top,
        prerequisite: p, mistakeIds: top.mistakeIds,
        reason: `You have missed “${top.name}” ${plural(top.mistakes, 'time')} across ${plural(top.sessions, 'session')}. It builds on “${p.name}”, which your memory ${p.attempts ? `estimates at only ${p.mastery}` : 'shows you have not practised yet'} — so today starts there.`,
      };
    }
    const partner = (contrasts[top.id] || []).map((c) => open.find((o) => o.id === c.id)).find(Boolean);
    if (partner) {
      return {
        activity: 'contrast_revision', rule: 'confusable-pair', primary: top, partner,
        focus: [{ id: top.id, name: top.name }, { id: partner.id, name: partner.name }],
        mistakeIds: [...top.mistakeIds.slice(0, 3), ...partner.mistakeIds.slice(0, 2)],
        reason: `You have missed both “${top.name}” (${plural(top.mistakes, 'mistake')}) and “${partner.name}” (${plural(partner.mistakes, 'mistake')}), and they are easy to confuse. Today's revision puts them side by side.`,
      };
    }
    return {
      activity: 'revise_concept', rule: 'recurring-mistake', primary: top, focus: [{ id: top.id, name: top.name }], mistakeIds: top.mistakeIds,
      reason: `You answered ${plural(top.mistakes, 'question')} about “${top.name}” incorrectly across ${plural(top.sessions, 'session')} (estimated mastery ${top.mastery ?? 0}). Today's revision focuses on that.`,
    };
  }
  const gap = lowListening.find((l) => l.weakConcepts?.length);
  if (gap) {
    return {
      activity: 'topic_revision', rule: 'listening-gap', focus: gap.weakConcepts.slice(0, 3), mistakeIds: [gap.logId], listening: gap,
      reason: `You rated your comprehension of “${gap.title}” ${gap.rating}/5. Its topic (${gap.topics.join(', ')}) is linked to concepts you have not mastered, so we revise those first.`,
    };
  }
  if (due.length) {
    return {
      activity: 'review_due', rule: 'overdue', focus: due.slice(0, 3).map((d) => ({ id: d.id, name: d.name })), mistakeIds: [], due,
      reason: `${plural(due.length, 'item')} ${due.length === 1 ? 'is' : 'are'} due for review (for example “${due[0].name}”). Reviewing at the right time keeps them in memory.`,
    };
  }
  const g = nextGrammar[0];
  const v = nextVocab.slice(0, 2);
  const focus = [...(g ? [{ id: g.id, name: g.name }] : []), ...v.map((x) => ({ id: x.id, name: x.name }))];
  return {
    activity: 'new_material', rule: noHistory ? 'first-session' : 'next-in-sequence', focus, mistakeIds: [],
    reason: noHistory
      ? 'There is no study history for this profile yet, so we begin at the start of the curriculum.'
      : `You have no recurring mistakes and nothing is overdue, so the next step is new material${g ? `: “${g.name}” (its prerequisites are already practised)` : ''}.`,
  };
}

export class PlannerAgent {
  constructor({ memory, catalog, clock = Date.now }) {
    Object.assign(this, { memory, catalog, clock });
  }

  async preferences(learnerId) {
    return effectivePrefs(await this.memory.preferences(learnerId));
  }

  /** Read everything needed to decide, from the graph. */
  async gather(learnerId, now) {
    const [recurring, due, nextGrammar, nextVocab, prog, lowRaw] = await Promise.all([
      this.memory.recurringMistakes(learnerId, 1),
      this.memory.dueItems(learnerId, now, 10),
      this.memory.nextGrammar(learnerId, 3),
      this.memory.nextVocabulary(learnerId, 3),
      this.memory.progress(learnerId),
      this.memory.lowListeningRatings(learnerId, 2),
    ]);
    const prereqs = {}, contrasts = {};
    for (const r of recurring.filter((x) => x.mistakes >= 2).slice(0, 6)) {
      prereqs[r.id] = await this.memory.prerequisites(learnerId, r.id);
      contrasts[r.id] = await this.memory.contrastPartners(r.id);
    }
    const lowListening = [];
    for (const l of lowRaw) {
      const weak = [];
      for (const tid of l.topicIds) {
        for (const c of await this.memory.conceptsForTopic(tid, learnerId, 4)) if ((c.mastery ?? 0) < 0.6) weak.push({ id: c.id, name: c.name });
      }
      lowListening.push({ ...l, weakConcepts: weak });
    }
    const studied = Object.values(prog).reduce((n, p) => n + (p?.studied ?? 0), 0);
    return { recurring, due, nextGrammar, nextVocab, prereqs, contrasts, lowListening, progress: prog, noHistory: studied === 0 };
  }

  /** Compute + persist the primary (study) and secondary (listening) recommendations for the current memory state. */
  async plan(learnerId, log) {
    const learner = await this.memory.getLearner(learnerId);
    const now = this.clock();
    const version = learner.memoryVersion ?? 0;
    const prefs = await this.preferences(learnerId);
    const ctx = await this.gather(learnerId, now);
    const d = decide(ctx);
    const demoShare = d.primary ? d.primary.demoMistakes : 0;
    const evidence = {
      rule: d.rule, focus: d.focus, mistakeIds: d.mistakeIds, stateVersion: version,
      mistakeCount: d.primary?.mistakes ?? 0, sessionCount: d.primary?.sessions ?? 0,
      demoMistakes: demoShare, liveMistakes: (d.primary?.mistakes ?? 0) - demoShare,
      mastery: d.primary?.mastery ?? null, status: d.primary?.status ?? null,
      prerequisite: d.prerequisite ?? null, contrast: d.partner ? { id: d.partner.id, name: d.partner.name, mistakes: d.partner.mistakes } : null,
      dueCount: ctx.due.length,
    };
    const primary = {
      id: `rec:${learnerId}:study:${h(d.activity + JSON.stringify(d.focus) + version)}`,
      learnerId, role: 'study', activity: d.activity, focusId: d.focus[0]?.id ?? '', focusName: d.focus.map((f) => f.name).join(' + '),
      reason: d.reason, evidence: JSON.stringify(evidence), stateVersion: version, createdAt: now, agent: 'memory_planner',
      isDemoBasis: demoShare > 0 && demoShare === (d.primary?.mistakes ?? 0),
      targets: d.focus.map((f) => f.id), basedOn: d.mistakeIds,
    };
    const recs = [primary];

    if (prefs.include_listening === 'true') {
      const listen = await this.planListening(learnerId, d, ctx, version, now);
      if (listen) recs.push(listen);
    }
    for (const rec of recs) await this.memory.saveRecommendation(rec);
    await this.memory.c.query(
      "MATCH (r:Recommendation {learnerId: $lid}) WHERE NOT r.id IN $ids AND r.status = 'active' SET r.status = 'superseded'",
      { lid: learnerId, ids: recs.map((r) => r.id) },
    );
    if (log) {
      await log.log('memory_planner', 'plan_recommendation', {
        key: `v${version}`,
        retrieved: { recurringMistakeConcepts: ctx.recurring.length, dueItems: ctx.due.length, nextGrammar: ctx.nextGrammar.length, lowListeningLogs: ctx.lowListening.length, memoryVersion: version },
        changed: { recommendationsWritten: recs.map((r) => r.id), superseded: 'previous active recommendations' },
        output: { activity: primary.activity, focus: primary.focusName, rule: d.rule, listening: recs[1]?.focusName ?? null },
        handoff: 'recommendation',
      });
    }
    return recs.map((r) => ({ ...r, evidence }));
  }

  async planListening(learnerId, d, ctx, version, now) {
    const focusIds = d.focus.map((f) => f.id);
    const topicRows = focusIds.length ? await this.memory.conceptTopics(focusIds) : [];
    const topicIds = [...new Set(topicRows.map((t) => t.topicId))];
    const lessons = await this.memory.lessonsForTopics(learnerId, topicIds, 3);
    if (!lessons.length) return null;
    const best = lessons.find((l) => l.overlap > 0 && !l.watched) || lessons.find((l) => l.overlap > 0) || lessons.find((l) => !l.watched) || lessons[0];
    const via = best.overlap > 0 ? topicRows.filter((t) => best.shared.includes(t.topic)) : [];
    const path = via.length ? { concept: via[0].conceptId, topic: via[0].topic, lesson: best.id } : null;
    const reason = path
      ? `“${best.title}” shares the topic “${path.topic}” with “${d.focus.find((f) => f.id === path.concept)?.name ?? path.concept}” (matched on the video title), so listening to it reinforces today's focus.`
      : `No catalogued lesson matches today's focus topic; this is the ${best.watched ? 'least-recently relevant' : 'newest unwatched'} listening practice.`;
    return {
      id: `rec:${learnerId}:listen:${h(best.id + version)}`, learnerId, role: 'listen', activity: 'listen', focusId: best.id, focusName: best.title,
      reason, evidence: JSON.stringify({ rule: path ? 'topic-overlap' : 'newest-unwatched', path, difficulty: best.difficulty, stateVersion: version }),
      stateVersion: version, createdAt: now, agent: 'memory_planner', isDemoBasis: false,
      targets: [best.id], basedOn: [],
    };
  }

  /** Persist one evaluated attempt and update semantic memory. Idempotent on attemptId. */
  async recordAttempt({ learnerId, sessionId, attemptId, exercise, answer, evaluation, ms = 0, isDemo = false, at, explicitNow }) {
    return withLock(learnerId, async () => {
      const existing = await this.memory.getAttempt(attemptId);
      if (existing) return { duplicate: true, attempt: existing };
      const now = explicitNow ?? at ?? this.clock();
      const prefs = await this.preferences(learnerId);
      const states = await this.memory.getStudyStates(learnerId, exercise.conceptIds);
      const studies = [];
      const changes = [];
      for (const conceptId of exercise.conceptIds) {
        const prev = states[conceptId] ?? EMPTY_STATE;
        const next = updateStudyState(prev, { correct: evaluation.correct, quality: evaluation.quality, now, pace: prefs.revision_pace });
        studies.push({ conceptId, state: next, before: { mastery: prev.mastery ?? 0, status: prev.status ?? 'new' } });
        changes.push(`STUDIES(${conceptId}): mastery ${prev.mastery ?? 0} → ${next.mastery}, status ${prev.status ?? 'new'} → ${next.status}`);
      }
      const main = studies[0];
      const attempt = {
        id: attemptId, learnerId, sessionId, exerciseId: exercise.id, conceptId: main.conceptId, at: now, ms,
        correct: evaluation.correct, ambiguous: !!evaluation.ambiguous, quality: evaluation.quality,
        answer: String(answer ?? '').slice(0, 300), expected: String(exercise.answer ?? '').slice(0, 300),
        type: exercise.type, format: formatOf(exercise.type), origin: exercise.origin ?? '',
        masteryBefore: main.before.mastery, masteryAfter: main.state.mastery, statusAfter: main.state.status,
        feedback: evaluation.note ?? '', explanation: exercise.explanation ?? '', isDemo,
      };
      const mistake = evaluation.correct ? null : {
        id: `mistake:${attemptId}`, learnerId, conceptId: main.conceptId, at: now, given: attempt.answer, expected: attempt.expected,
        prompt: String(exercise.prompt ?? '').slice(0, 200), exerciseId: exercise.id, isDemo,
      };
      await this.memory.writeAttempt({ attempt, mistake, studies: studies.map((s) => ({ conceptId: s.conceptId, state: s.state })) });
      const version = await this.memory.bumpMemoryVersion(learnerId);
      return { duplicate: false, attempt, mistake, studies, changes, version };
    });
  }

  async completeSession({ learnerId, sessionId, log, isDemo = false, endedAt }) {
    return withLock(learnerId, async () => {
      const session = await this.memory.getSession(sessionId);
      const sessions = await this.memory.c.query(
        'MATCH (:LearningSession {id: $sid})-[:INCLUDES]->(a:Attempt) RETURN count(a) AS n, sum(CASE WHEN a.correct THEN 1 ELSE 0 END) AS ok',
        { sid: sessionId },
      );
      const { n, ok } = sessions[0];
      if (session.status !== 'completed') await this.memory.completeSession(sessionId, { endedAt: endedAt ?? this.clock(), score: n ? Math.round((ok / n) * 100) : 0 });

      // procedural memory: infer format affinity from repeated evidence
      const stats = await this.memory.formatStats(learnerId);
      const procedural = [];
      for (const [format, s] of Object.entries(stats)) {
        if (s.attempts >= 3) {
          await this.memory.upsertPreference({ learnerId, key: `affinity:${format}`, value: Math.round((s.correct / s.attempts) * 100), source: 'inferred', evidenceCount: s.attempts, evidence: `${s.correct}/${s.attempts} correct` });
          procedural.push(`affinity:${format}=${Math.round((s.correct / s.attempts) * 100)}%`);
        }
      }
      const best = inferBestFormat(stats);
      if (best) {
        await this.memory.upsertPreference({ learnerId, key: 'inferred_format', value: best.format, source: 'inferred', evidenceCount: best.attempts, evidence: `${Math.round(best.accuracy * 100)}% accuracy over ${best.attempts} attempts, ≥20 points above other formats` });
        procedural.push(`inferred_format=${best.format}`);
      } else {
        await this.memory.deletePreference(learnerId, 'inferred_format');
      }
      const version = await this.memory.bumpMemoryVersion(learnerId);
      if (log) {
        await log.log('memory_planner', 'close_session', {
          key: sessionId,
          retrieved: { attemptsInSession: n, correct: ok, formatStats: stats },
          changed: { sessionStatus: 'completed', score: n ? Math.round((ok / n) * 100) : 0, proceduralMemory: procedural, memoryVersion: version },
          output: { score: n ? Math.round((ok / n) * 100) : 0 }, handoff: 'session_closed',
        });
      }
      const recs = await this.plan(learnerId, log);
      return { attempts: n, correct: ok, score: n ? Math.round((ok / n) * 100) : 0, recommendations: recs, procedural, isDemo };
    });
  }

  /** Explicit procedural memory: the learner corrects a preference. */
  async setPreference(learnerId, key, value) {
    if (!PREF_RULES[key] || !PREF_RULES[key](value)) {
      const err = new Error(`Invalid preference "${key}"`); err.status = 400; throw err;
    }
    await this.memory.upsertPreference({ learnerId, key, value, source: 'explicit', evidenceCount: 1, evidence: 'Set by the learner' });
    await this.memory.bumpMemoryVersion(learnerId);
  }

  async clearPreference(learnerId, key) {
    if (!PREF_RULES[key] && key !== 'inferred_format') { const err = new Error('Unknown preference'); err.status = 400; throw err; }
    await this.memory.deletePreference(learnerId, key);
    await this.memory.bumpMemoryVersion(learnerId);
  }
}
