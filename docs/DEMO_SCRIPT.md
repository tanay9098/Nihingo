# Demo script (≈ 6 minutes) — “Memory that changes the next lesson”

Everything below was run against a real FalkorDB; the numbers are what the app produced. The exact same flow runs headlessly with
`npm run demo:flow` (prints every recommendation, evidence line and agent handoff).

**Before you start:** `docker compose up --build` (or `npm start`), open <http://localhost:3002> **without signing in**: guests always see the
demo learner Aiko (the blue banner says so). If you are signed in, pick **Demo learner (Aiko)** in the top bar instead.
If someone already clicked around: **Memory → Reset the demo → Restore seeded demo**.

## 0. Setup talk track (20 s)
“Nihongo Graph remembers what a learner studied. Three agents — Tutor, Examiner, Memory & Planner — never pass data to each other directly; they coordinate only through
a persistent FalkorDB graph. Aiko's three earlier sessions are **seeded demo data** (blue *demo data* badges); anything we do now is live.”

## 1. Dashboard — the starting memory (45 s)
1. **Today** shows *Targeted revision — に*: “You answered 3 questions about に incorrectly across 3 sessions (estimated mastery 0.078)…”.
2. Open **Why this recommendation?** → rule *Recurring mistake*, *3 mistakes in 3 sessions (3 from seeded demo history, 0 from live answers)*, graph path info, memory version.
3. Point at **Recently missed** (all *demo data*), **Grammar needing revision** (に struggling, で learning) and the **Learner memory graph** (red edge = struggling).
4. Point at **Your learning path**: Aiko's seeded sessions only covered grammar and vocabulary, so *Hiragana* is “You are here” while *First words* (3/56) and *Sentence patterns* (4/16) already show progress.
   Revision comes first, so today's plan is に; new items are drawn from the current step.
5. Point out the mode badge: **Demo mode** — no LLM key, real FalkorDB persistence, deterministic agents.

## 2. Session 1 — the learner repeats the mistakes (60 s)
1. **Start today's session**. The Tutor briefing shows the に explanation (from `grammar.json`, with source). The Examiner's five questions each show **why** they were chosen:
   1. `駅＿行きます。 (destination)` — *Revision of a recurring mistake*
   2. `家＿本を読みます。 (where the action happens)` — *Confusable with に (CONTRASTS_WITH)* ← graph-derived
   3. `月曜日＿学校に行きます。 (time)` — *Revision of a recurring mistake*
   4. `station` — *Due for review*
   5. `a (hiragana)` — *New material · Step 1: Hiragana* ← from the learning path
2. **Deliberately answer every question wrong** (any option except the correct one: に for Q1/Q3, で for Q2, あ for Q5). After each answer the feedback shows the memory update, e.g.
   *に: estimated mastery 0.078 → 0.037 · struggling*.
3. **Finish session**.

## 3. Memory update + Session 2 recommendation (60 s)
The summary page now says **Compare confusable concepts — に + で**: “You have missed both に (5 mistakes) and で (2 mistakes), and they are easy to confuse.”
* **Why this recommendation?** → *3 from seeded demo history, 2 from live answers*; *Graph path: CONTRASTS_WITH — で (2 mistakes)*. The recommendation changed from `revise_concept` to `contrast_revision` **because the graph changed**.
* **Agent handoffs in this session** shows the real chain: Tutor *retrieve_memory* → Tutor *recommend_and_explain* → Examiner *select_exercises* → (Examiner *evaluate_answer* → Memory & Planner *update_memory*) ×5 → Memory & Planner *close_session* → *plan_recommendation*.
* “Procedural memory updated: affinity:typed=50%, affinity:multiple_choice=50%” — study habits inferred from evidence.

## 4. Session 2 — the Tutor reads the updated state (45 s)
1. **Start the next session**: the Tutor's explanation is the new one; questions are labelled *Side-by-side revision of confusable concepts* (に and で together).
2. Answer correctly this time (Q5 is the next hiragana, `i (hiragana)`). Finish: score 100 %, mastery rises (に 0.031 → 0.125 → 0.196), and the next recommendation moves on to **で** alone (*2 mistakes across 2 sessions; 1 demo, 1 live*) because に has recovered (last two answers right).

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
revising concepts that share the lesson's topic (show it on a fresh account, see step 8: rate a food/café lesson 1 → *Topic revision*).

## 8. A learner of your own (45 s)
1. **Create account** (top bar, or the link in the demo banner) → name, email, password of at least 8 characters. You land on **Today** signed in;
   the top bar shows **My path (*name*)** and **Sign out**, and the demo banner is gone.
2. A new account starts its **own, empty learning path**: the “Start here” note, Step 1 *Hiragana* as “You are here”, and a first session of あ, い, う.
   None of Aiko's history appears — each account owns its learner memory, and the server takes the learner from the sign-in, never from the browser.
3. Optional: the top-bar switcher **Demo learner (Aiko)** ↔ **My path** shows both side by side; **Sign out** returns to the guest demo view,
   and signing back in resumes exactly where the account left off. A second account (e.g. in a private window) sees only its own path.

## 9. Reset
Switch the top bar back to **Demo learner (Aiko)** (or **Sign out**), then **Memory → Restore seeded demo** returns Aiko to the starting state so the demo can be repeated. On your own account the same card reads
**Delete my progress**: it empties that learning path but keeps the account.

### If something goes wrong
* The dashboard says “The graph database is starting up”: wait for FalkorDB's health check (≈ 10 s) and press *Try again*.
* The YouTube player stays black (offline / blocked): use the “Open it on YouTube” link; everything else works offline.
* “Your sign-in has expired”: the session lasted longer than `SESSION_TTL_DAYS` (default 30) or you signed out in another tab — sign in again.
  Sign-in never works behind plain `http://` with `COOKIE_SECURE=1`; leave it at `0` for a local demo.
* Questions differ from the list above: the Examiner is deterministic *for a given graph state*; if the demo learner was used before, restore the seeded demo first.
