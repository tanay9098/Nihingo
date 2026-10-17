# Demo script (≈ 5 minutes) — “Memory that changes the next lesson”

Everything below was run against a real FalkorDB; the numbers are what the app produced. The exact same flow runs headlessly with
`npm run demo:flow` (prints every recommendation, evidence line and agent handoff).

**Before you start:** `docker compose up --build` (or `npm start`), open <http://localhost:3002>, keep the profile on **Demo learner (Aiko)**.
If someone already clicked around: **Memory → Reset the demo → Restore seeded demo**.

## 0. Setup talk track (20 s)
“Nihongo Graph remembers what a learner studied. Three agents — Tutor, Examiner, Memory & Planner — never pass data to each other directly; they coordinate only through
a persistent FalkorDB graph. Aiko's three earlier sessions are **seeded demo data** (blue *demo data* badges); anything we do now is live.”

## 1. Dashboard — the starting memory (45 s)
1. **Today** shows *Targeted revision — に*: “You answered 3 questions about に incorrectly across 3 sessions (estimated mastery 0.078)…”.
2. Open **Why this recommendation?** → rule *Recurring mistake*, *3 mistakes in 3 sessions (3 from seeded demo history, 0 from live answers)*, graph path info, memory version.
3. Point at **Recently missed** (all *demo data*), **Grammar needing revision** (に struggling, で learning) and the **Learner memory graph** (red edge = struggling).
4. Point out the mode badge: **Demo mode** — no LLM key, real FalkorDB persistence, deterministic agents.

## 2. Session 1 — the learner repeats the mistakes (60 s)
1. **Start today's session**. The Tutor briefing shows the に explanation (from `grammar.json`, with source). The Examiner's five questions each show **why** they were chosen:
   1. `駅＿行きます。 (destination)` — *Revision of a recurring mistake*
   2. `家＿本を読みます。 (where the action happens)` — *Confusable with に (CONTRASTS_WITH)* ← graph-derived
   3. `月曜日＿学校に行きます。 (time)` — *Revision of a recurring mistake*
   4. `station` — *Due for review*
   5. `私は先生＿＿。` — *New material*
2. **Deliberately answer every question wrong** (any option except the correct one: に for Q1/Q3, で for Q2). After each answer the feedback shows the memory update, e.g.
   *に: estimated mastery 0.078 → 0.037 · struggling*.
3. **Finish session**.

## 3. Memory update + Session 2 recommendation (60 s)
The summary page now says **Compare confusable concepts — に + で**: “You have missed both に (5 mistakes) and で (2 mistakes), and they are easy to confuse.”
* **Why this recommendation?** → *3 from seeded demo history, 2 from live answers*; *Graph path: CONTRASTS_WITH — で (2 mistakes)*. The recommendation changed from `revise_concept` to `contrast_revision` **because the graph changed**.
* **Agent handoffs in this session** shows the real chain: Tutor *retrieve_memory* → Tutor *recommend_and_explain* → Examiner *select_exercises* → (Examiner *evaluate_answer* → Memory & Planner *update_memory*) ×5 → Memory & Planner *close_session* → *plan_recommendation*.
* “Procedural memory updated: affinity:typed=50%, affinity:multiple_choice=50%” — study habits inferred from evidence.

## 4. Session 2 — the Tutor reads the updated state (45 s)
1. **Start the next session**: the Tutor's explanation is the new one; questions are labelled *Side-by-side revision of confusable concepts* (に and で together).
2. Answer correctly this time. Finish: score 100 %, mastery rises (に 0.031 → 0.125 → 0.196), and the next recommendation moves on to **で** alone (*2 mistakes across 2 sessions; 1 demo, 1 live*) because に has recovered (last two answers right).

## 5. Proof it is real graph state (60 s)
1. **Memory** page → **Agent activity**: each row is an `AgentEvent` node — *Read / Changed / Output* are real values; the Session-2 Tutor event shows `storedRecommendation.id` = the recommendation the Planner wrote at the end of Session 1.
2. **Three memories**: Episodic (sessions, mistakes, demo badges), Semantic (mastery per concept), Procedural (preferences + inferred format with its evidence).
3. **Graph explorer**: click **に** → see `CONTRASTS_WITH` → で, `REQUIRES` → 〜ます, mistakes' topics. Bounded to ≤ 50 nodes.
4. Optional: open the **FalkorDB Browser** at <http://localhost:3000> (Docker image `falkordb/falkordb`) and run  
   `MATCH (r:Recommendation {learnerId:'learner:demo'})-[:BASED_ON]->(m:Mistake)-[:ABOUT]->(c) RETURN r,m,c` — the evidence behind the recommendation.
   (Graph name: `nihongo`; select it in the Browser.)

## 6. Procedural memory changes behaviour (30 s)
**Memory → Correct my preferences**: set *Preferred exercise format → Typed answers* and *Questions per session → 3*, then **Practice**: the first question is now typed (`Type the particle: …`).
Remove or change it any time; inferred preferences can be deleted with “That's wrong — remove”.

## 7. Listening (30 s)
**Listening** → recommended lesson with its reason; “Watch” plays through YouTube's official embed, with a direct YouTube link as fallback. Levels shown are only those stated in the
video titles (*N5 (per title)*). Rate comprehension 1–5 with a note → stored as `ListeningLog` in episodic memory. A rating of 1–2 on a fresh profile makes the Planner recommend
revising concepts that share the lesson's topic (switch to **My profile** to show it: rate a food/café lesson 1 → *Topic revision*).

## 8. Reset
**Memory → Restore seeded demo** returns Aiko to the starting state so the demo can be repeated.

### If something goes wrong
* The dashboard says “The graph database is starting up”: wait for FalkorDB's health check (≈ 10 s) and press *Try again*.
* The YouTube player stays black (offline / blocked): use the “Open it on YouTube” link; everything else works offline.
* Questions differ from the list above: the Examiner is deterministic *for a given graph state*; if the demo learner was used before, restore the seeded demo first.
