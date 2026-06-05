# hAIve — Battle Plan & Competitive Positioning

> **Purpose of this document.** A single, grounded reference to position hAIve against the field and
> win. It consolidates: the harness-engineering frame, what hAIve has actually built (verified in
> code, not on the surface), the competitive landscape, an analysis of agents' *real* needs, where
> hAIve fills them vs. where it doesn't, the two strategic risks, and the plan to win.
>
> **Rule for this document:** no hype. A battle plan that oversells is useless. Every strength is
> grounded in code; every weakness is named. The honesty *is* the weapon — it's what lets us aim.
>
> _Last consolidated: 2026-06-03 (hAIve v0.17.0); progress notes added 2026-06-04 (v0.26.1). Source: a
> multi-session dogfooding + research effort where the analyst drove hAIve end-to-end to ship
> v0.15.0 → v0.26.1._
>
> **Status update (v0.26.1):** the three adoption levers in §8 have largely shipped — 12 native bridges
> generated at init (reach), cold-start seeding from stack/git/scanners **with a quality floor** (kill
> cold-start), and a dashboard "Value" line + briefing proof line (visible value). The measured loop's
> prevention-recording leak (the "measure" leg) was closed in v0.22.0. The two **strategic risks** in §7
> (adoption-order inversion, the autonomy bet) remain the open fronts; they are about timing, not shape.

---

## 0. TL;DR — the thesis in one paragraph

A capable model already knows generic best practice. It fails on two things: **the non-guessable**
(acting without the team's repo-specific knowledge → plausible-but-wrong-by-policy) and **the ignored**
(told the rule, did it anyway). The market is crowded on *memory sophistication* (the least acute need
for coding agents) and nearly empty on **enforced, repo-specific, measured team knowledge** — the
deepest and highest-consequence need. hAIve owns that empty cell: **capture a team lesson → brief it
forward → block the repeat → measure that it helped.** That loop is the right shape; no competitor
combines all four. hAIve's job is to make that loop frictionless *early* enough that people feel it
before the corpus is mature.

---

## 1. The frame — harness engineering

Source: Martin Fowler / Birgitta Böckeler, *Harness engineering for coding agent users*; LangChain
"deep agents"; Addy Osmani; the `awesome-harness-engineering` list.

> **Agent = Model + Harness.** The harness is everything except the model: the context it gets before
> acting, the constraints while it acts, and the feedback loop that improves both.

Pillars (the lens we judge every tool with):

| Pillar | Meaning |
|---|---|
| **Guides (feedforward)** | Steer *before* acting: docs, conventions, skills, injected context |
| **Sensors (feedback)** | Observe *after* acting to self-correct: linters, tests, structural checks, review agents |
| **Computational vs inferential** | Deterministic/fast (regex, lint, types) vs semantic/expensive (LLM) |
| **Keep quality left** | Distribute checks as early as cost/speed allow |
| **3 regulation layers** | *Maintainability* (mature) → *Architecture fitness* (medium) → *Behaviour/correctness* (hardest, least solved) |
| **The ratchet** | Every mistake becomes a permanent rule, traced to a real failure |
| **Governance ("on the loop")** | The human iterates on the harness, not on each output |
| **Fowler's open challenges** | (a) incoherence at scale, (b) **measuring harness coverage/quality**, (c) drift, (d) behavioural confidence |

**Key proof point from the field:** LangChain moved Terminal-Bench 2.0 from **52.8% → 66.5%** (outside
Top 30 → Top 5) by **changing only the harness, not the model.** The system around the model often
matters more than the model. This is the macro-bet hAIve rides.

---

## 2. What hAIve is (and is not)

**Is:** the repo-native **team-knowledge layer inside a coding-agent harness** — feedforward briefing
before work, feedback gates after, anchored to the code paths the knowledge describes. It owns the
**Maintainability / repo-specific-policy** slice.

**The loop (the product, not just memory):**
`capture (mem_tried / mem_save) → brief (get_briefing) → block the repeat (sensors + anti-pattern gate)
→ measure (prevention events, impact) → self-eval (recall / MRR / catch-rate)`.

**Is NOT** (deliberate scope boundaries — say these out loud, they're a strength):
- Not a general-purpose memory database (no vector/graph sophistication; the repo is already the memory).
- Not a *behaviour* harness (test generation/verification) — it complements tests, never replaces them.
- Not a per-user personalization store — it is **team-shared, git-committed**.

---

## 3. What hAIve has actually built (proof of substance)

All verified in code. This is what lets us claim the loop is real, not a slogan.

**Core capabilities**
- **Feedforward:** `get_briefing` — project + module context + ranked breadcrumbs + skills with
  *progressive activation*, under a **token budget** with cascade truncation (not a static dump).
- **Feedback (computational):** deterministic **regex sensors**, plus **shell/test sensors** (v0.16.0).
- **Feedback (inferential):** semantic **anti-pattern** matching with a high-precision **hard-block**
  gate (anchored + diff-corroborated + high-confidence), tunable via `enforcement.antiPatternGate`.
- **The ratchet is wired end-to-end:** `mem_tried` auto-generates a sensor → it fires on a future
  diff → records a **prevention event** → feeds the **impact** score.
- **Outcome measurement:** `prevention` (events, 7d/30d/weekly trend, recurrence) + `impact`
  (separates *read* ≠ *applied* ≠ *prevented*; reads capped so "surfaced" ≠ "useful").
- **Self-eval:** `eval` — deterministic recall / MRR / sensor catch-rate, baseline/compare, CI-runnable,
  now trended (`--record` / `--trend`). **This directly answers Fowler's "measure harness quality"
  open challenge — almost no one else does.**
- **Coherence/drift control:** stale-anchor detection, conflict-candidates + `resolve-conflict`,
  retirement, decay.
- **Gates that actually block:** git hooks + CI with real exit codes; decision-coverage; failure-capture.
- **Safety:** `requires_human_approval` → `action_required` (stop-and-ask on cross-repo breaking changes).

**Recently closed gaps (the corpus is maturing fast):**
- v0.15.0 — 8 harness-engineering gaps (shell/test sensors, failure-capture gate, coverage-gap
  detection, eval trend, conflict resolution, gate precision, git-history seeding, `.ai/` merge driver).
- v0.16.x — dogfooding friction fixes: **decision-coverage now accumulates across briefings**
  (the #1 friction, gone); **failure detection de-noised** (grep/pipe exits no longer cry wolf);
  **dev-env-workaround memories down-ranked** so team policy keeps the top slots; **auto-recaps
  compacted**; **anti-pattern self-match false positive fixed**.
- v0.17.0 — **one shared priority classifier** in core, ending the CLI/MCP ranking drift.

---

## 4. The competitive landscape — three adjacent families

No tool does exactly what hAIve does. There are three *neighbours*:

### Family 1 — Agent memory layers (vector/graph)
**Mem0, Zep/Graphiti, Letta (MemGPT), Cognee, LangMem, Supermemory.** Sophisticated stores: automatic
extraction, semantic recall, temporal knowledge graphs (Zep), memory-as-OS (Letta). Funded, mature,
benchmarked (LoCoMo, LongMemEval). Mostly **per-user/per-agent, cloud**.
→ hAIve is **not** this and shouldn't try to be. The repo *is* the memory for coding tasks.

### Family 2 — Memory banks / rules files
**AGENTS.md (standard), CLAUDE.md, .cursorrules, Cline Memory Bank, Cursor Memories/Notepads,
memories.sh, agentmemory.** Repo-committed markdown injected into the prompt. memories.sh goes
furthest: generates native configs for 20+ agents ("one memory store, every coding agent").
→ **Closest in spirit.** But they **inject context and stop there.** memories.sh's own words:
*"it doesn't block or enforce — it retrieves and surfaces."*

### Family 3 — Guardrails / fitness functions / governance
**Architecture tests / fitness functions, NeMo Guardrails, Guardrails AI, Lakera, block-no-verify,
policy-as-prompt, multi-agent validation chains.** They **enforce** — deterministically, 100% in CI —
but on **generic/structural rules you hand-write** (architecture, safety, PII, format).
→ They enforce *generic*; hAIve enforces *repo-specific*, **derived from captured lessons**.

**hAIve's cell = intersection of Family 2 × Family 3, minus Family 1.**

---

## 5. The real-needs analysis — what actually makes agents fail

Judge tools by what causes task failure, not by sophistication. Coding agents fail on:
1. **The non-guessable** — acting without the team's specific context → plausible but wrong by policy.
2. **The ignored** — told the rule, did it anyway (the "said it 11 times" failure).

**Ranking of real needs (for *coding* agents):**

1. **Feedforward repo context (broadest).** Every task benefits from "here's what you can't guess."
   Cheapest, most universal. *Fatal flaw: it's advisory — agents ignore advice; feedforward alone plateaus.*
2. **Enforcement of repo-specific policy (most critical, esp. autonomous).** The only thing that closes
   the "ignored" gap. Pays off only on the minority of dangerous actions, but there's no substitute.
   *Flaw: blind (only checks what's encoded) and frustrating (false positives → ignored).*
3. **Raw vector/graph memory (least acute for code, most over-invested).** Real need — but for *other*
   agents (assistants, support bots, long-running autonomous). For "fix this bug," the repo is the memory.

**The need shifts with autonomy:**

| Agent type | #1 real need |
|---|---|
| Supervised, short tasks (human reviews) | **Feedforward** — give context, the human catches the rest |
| Autonomous / long-running (no one watching) | **Enforcement** — the only wall before a bad merge |
| Conversational / personal | **Vector/graph memory** — here Family 1 genuinely wins |

**The truth the ranking hides:** feedforward and enforcement are not two needs — they're **two halves
of one loop.** Knowing without being stopped from ignoring is insufficient; being blocked without
knowing why is unlivable. Feedforward-only and feedback-only are *both* anti-patterns (Fowler).

---

## 6. hAIve's position on real needs — the scorecard

Grading by **real-need-filled**, not sophistication.

| Real need (coding agents) | Memory banks | Vector/graph | Guardrails | **hAIve** |
|---|---|---|---|---|
| **A. Feedforward context** (broadest) | **Strong** (purpose-built, broad reach) | Medium (per-user/cloud, not team-policy-shaped) | Weak (not their job) | **Strong mechanism, weaker reach + cold-start** |
| **B. Repo-specific enforcement** (most critical when autonomous) | **None** (advisory) | None | Medium (enforces *generic*, hand-written) | **Best in class** |
| **C. The loop** capture→brief→block→**measure** | ~None | ~None | ~None | **Alone / ahead** |
| **D. Raw conversational memory** (least acute for code) | Weak | **Dominant** | n/a | Weak (by design) |
| **Meta: adoption / reach** | **Very high** (standard, every agent) | High | High | **Low / early, MCP-first** |

**Reading it:**
- On the **broadest** need (A): **competitive, not dominant.** Better mechanism than a static
  AGENTS.md, but dedicated tools win on **reach** (memories.sh = 20+ native configs) and **cold-start**
  (hAIve is worth ~zero until the corpus is fed). *This is where adoption starts — and we're good, not ahead.*
- On the **most critical** need (B): **we are the best.** Others leave this entirely open.
- On the **loop** (C): **we are alone** — but on a need few have yet *articulated* ("ahead in empty space").
- On the **over-rated** need (D): **behind, and it barely costs us** — least real for coding agents.

---

## 7. The two strategic risks (name them, plan around them)

1. **Adoption-order inversion.** People need the *broad* thing (feedforward) **first**; hAIve's edge
   (enforcement, measurement) only shows value **after** corpus investment. We sell our strength at the
   moment the user can't feel it yet.
2. **The autonomy bet.** Enforcement is most acute for **autonomous/unsupervised** agents — still a
   minority of real usage. hAIve is positioned for **where the puck is going**, not the present mass need.

Neither risk is about the *shape* (feedforward + feedback + measurement is correct). Both are about
**timing**: hAIve shines downstream (autonomy, enforcement, measurement) while adoption is won upstream
(frictionless feedforward, cold-start, multi-agent reach).

---

## 8. How we win — the battle plan

**Our moat (lean in):**
- **Enforcement of repo-specific policy + the measured loop.** Nobody else has it. Every demo should
  show: agent about to repeat a documented mistake → **blocked**, with the lesson, then the
  **prevention count** going up. That's the "aha" no memory bank or guardrail can reproduce.
- **Self-eval as proof.** "We can show, with a number, that the harness helps and isn't regressing"
  (recall/MRR/catch-rate trend). Answers the question every buyer of an AI tool secretly has.

**Close the timing gap (the actual work, in priority order):**
1. **Kill cold-start.** ✅ *Largely shipped (v0.18–0.26).* Value must appear in session #1, not after 50
   memories. Auto-seed from signals the repo already has: git revert/hotfix/workaround history
   (`seed-git`), lint/CI/Sonar/npm-audit findings (`ingest`, with `sarif`/`sonar`/`eslint`/`npm-audit`),
   and 20+ curated stack packs. Every source now passes a **quality floor** so cold-start never ships
   generic, guessable advice. *Remaining: changelog ingest; broader real-world calibration.*
2. **Widen reach beyond MCP.** ✅ *Shipped (v0.18–0.19).* `haive init` now generates **12** native bridge
   configs (CLAUDE.md / AGENTS.md / Cursor / Cline / Windsurf / Continue / Cody / Zed / Roo / Gemini /
   Aider / Copilot) from the same corpus — carrying memories **and block sensors**, our edge over
   memories.sh (injection-only).
3. **Make value visible early.** ✅ *Shipped (v0.17.1, v0.24.0).* Briefing proof line ("prevented N
   repeated mistakes", silent on a cold corpus) + dashboard "Value" headline (repeats blocked 30d ·
   high-impact memories · active policies). *Remaining: a first-session "here's what I caught" summary.*
4. **Keep the harness helpful, not a burden.** Every false positive that trains an agent to ignore the
   gate is an existential bug (we hit and fixed several: failure-detection noise, anti-pattern
   self-match, decision-coverage friction, the prevention-recording leak in v0.22.0). Guard this ruthlessly.

**Don't fight where we lose:** don't chase vector/graph memory sophistication (Family 1) — it's the
least real need for code and a crowded, funded fight. Our narrowness is a feature.

---

## 9. Defensible claims vs. FUD (for demos, sales, debate)

Surface critiques people throw at this class of tool, and the code-grounded rebuttal:

- ❌ *"It just stores notes, it doesn't enforce."* → **False.** Real `process.exit` gates, anchored
  anti-pattern hard-block, regex + shell/test sensors on the diff.
- ❌ *"Metrics are vanity read-counts."* → **False.** `impact` caps reads; "high" requires *applied*
  or *prevented*.
- ❌ *"You can't know if it helps."* → **False.** `eval` (recall/MRR/catch-rate + baseline) **and**
  prevention trend/recurrence.
- ❌ *"Sensors are suggestions nobody uses."* → **False.** Wired into `mem_tried`/`mem_save`, fire on
  diffs, record prevention events that drive impact.
- ❌ *"It's just AGENTS.md with extra steps."* → **False.** AGENTS.md injects and stops; hAIve briefs,
  **blocks the repeat**, detects stale anchors, and **measures outcome**.

---

## 10. One-line positioning (use everywhere)

> **hAIve fills the most *consequential* need (enforced, repo-specific, measured team knowledge) better
> than anyone, is *competitive* on the most *frequent* need (feedforward context), and deliberately
> ignores the most *over-rated* one (raw memory). We don't need a better memory — we need the loop,
> and we need it to pay off in session one.**

---

## Sources

Harness engineering: [Fowler — Harness engineering](https://martinfowler.com/articles/harness-engineering.html) ·
[LangChain — Improving Deep Agents](https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering) ·
[Addy Osmani — Agent Harness Engineering](https://addyosmani.com/blog/agent-harness-engineering/) ·
[awesome-harness-engineering](https://github.com/ai-boost/awesome-harness-engineering).
Memory layers: [Mem0 — State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026) ·
[Mem0 vs Zep vs Letta vs Cognee](https://dev.to/agdex_ai/ai-agent-memory-in-2026-mem0-vs-zep-vs-letta-vs-cognee-a-practical-guide-cfa).
Memory banks: [Cline Memory Bank](https://www.kinde.com/learn/ai-for-software-engineering/ai-agents/how-to-write-a-memory-bank-for-your-ai-coding-agent/) ·
[AGENTS.md](https://kilo.ai/docs/customize/agents-md) · [memories.sh](https://memories.sh/).
Guardrails: [Architectural Guardrails for AI-Generated Code](https://codesai.com/posts/2026/04/minimal-architecture-constrainsts-in-agentic-world) ·
[AI Code Quality 2026 — Guardrails](https://tfir.io/ai-code-quality-2026-guardrails/) ·
[Git hooks vs AI agents](https://jonesrussell.github.io/blog/git-hooks-ai-agents/).
