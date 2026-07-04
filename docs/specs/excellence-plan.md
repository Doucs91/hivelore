# Spec — The Excellence Plan (v0.40 → v0.44)

> **For implementing agents.** Each phase below is a self-contained work order that one agent can
> execute independently. Read this header + your phase entirely before writing code. Work happens in
> THIS repo. Follow `CLAUDE.md` at all times: `get_briefing` before editing, `git pull` first,
> `mem_tried` immediately on failed approaches, decision memories for non-obvious choices, and
> `hivelore enforce finish` green (all GitHub Actions passing) before calling a phase done.
> Release protocol per phase: lockstep bump (minor for phases 1–3, patch for 4–5), tag, push, CI.

## 0. Why this plan exists — the competitive verdict

A full audit (2026-07-03/04, live gauntlet of v0.39.x + sourced competitor research) established:

**Hivelore's unique, defensible asset** — nobody else has it — is the chain:
*lived lesson → agent-proposed guard → deterministically VALIDATED (silent-on-current /
fires-on-bad / anti-brittleness / oracle-pending refusal) → same verdict at commit + CI →
prevention measured (receipts)*. Everything in this plan feeds that chain.

**Where competitors are better than our current implementation:**

| Area | Leader | How they do it (mechanism) | Our verdict |
|---|---|---|---|
| Passive memory capture | **claude-mem** (~75k ⭐) | 5 lifecycle hooks (SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd); PostToolUse captures tool observations; session-end compression into summaries; progressive-disclosure retrieval | **COPY the pipeline shape** onto our existing `observe` infra (Phase 2). We already have PostToolUse → `hivelore observe` → `observations.jsonl` → `session-end --auto`; only the last leg (distill failures into *proposed lessons*) is missing. |
| Static rule engine | **ast-grep / Semgrep** | AST-structural patterns (`pattern` / `kind` / `inside` / `has` / `not`), no false positives on comments/strings, `@ast-grep/napi` embeds in Node, extra languages via `@ast-grep/lang-*` + `registerDynamicLanguage` | **REUSE ast-grep** as a new sensor kind inside the existing sensor surface (Phase 1). Do not build our own matcher; our regex line-scan stays as fallback. |
| Team lessons from review feedback | **CodeRabbit Learnings** | A natural-language reply on a PR thread becomes a *learning record* (with PR number, filename, author); explicit "Learnings added" ack; loaded and applied to every future review, repo/org scoped | **COPY the creation flow, git-native** (Phase 3): PR review replies → `proposed` memories via the existing `ingest` command + GitHub Action, ack comment included. Our advantage: a learning here can graduate into a *blocking sensor*, which CodeRabbit can never do. |
| Behaviour verification depth | (open problem; our command sensors already lead) | — | **MODIFY our own validation** (Phase 4): prove the armed oracle actually goes RED on the incident; contain command execution. |
| Eval honesty vs eval power | promptfoo-style golden sets | Hand-labeled cases, regression CI | **MODIFY our eval** (Phase 5): the self-synthesized eval never caught the stack-pack ranking bug. Golden cases must come from real gate misses and review learnings. |

**What we deliberately will NOT copy** (rejected, do not re-litigate):
- **Cloud memory daemons** (byterover/cipher: SQLite+Chroma service, HTTP port, cloud sync). Violates
  repo-native determinism ("same diff, same verdict, versioned with the code"). Our storage stays
  Markdown-in-git.
- **LLM consolidation of the corpus** (claude-mem/AutoDream-style background rewriting). Inferential
  mutation of team truth; we already have `memory lint`, `memory conflicts`, decay warnings.
- **LLM-as-judge anywhere in a block decision.** Deterministic-only, forever.

## 1. Global constraints (apply to every phase)

- **No new product surface.** Modify existing commands/tools/flows. A new flag on an existing
  command is acceptable; a new top-level command or MCP tool requires explicit approval from Sady
  first (Phase 6 is the one sanctioned exception, and it is gated).
- Deterministic only in enforcement paths. Telemetry/capture must never break a commit or a hook
  (exit 0 always in hooks; best-effort writes).
- Nothing auto-generated is ever born `validated` or armed as `block` without passing the existing
  validation pipeline (`propose_sensor` stays the sole validated writer; auto-captured lessons are
  born `proposed`).
- Keep the four publishable packages in lockstep; core stays pure (no I/O), FS/exec lives in cli/mcp
  (dependency direction: cli→mcp→core; a shared I/O helper needed by both cli and mcp lives in mcp).
- Every phase ends with: unit tests + at least one live E2E in a scratch repo, README/CHANGELOG
  updated, decision memory saved, `hivelore enforce finish` green.

---

## Phase 1 — AST sensors: reuse ast-grep as the precision engine

**Verdict: REUSE (ast-grep) inside the existing sensor surface. Our regex engine is the weakest
form of static rule; ast-grep's structural patterns are the industry-best mechanism. We keep what
makes us unique (provenance + validation), and swap the matcher underneath.**

### Inspiration mechanism
`@ast-grep/napi`: `parse(Lang.Tsx, source).root()`, then `root.findAll({ rule: { pattern:
"stripe.paymentIntents.create($$$)", not: { has: { pattern: "idempotencyKey" } } } })`. JS-ecosystem
languages built in; Python/Go via optional `@ast-grep/lang-*` + `registerDynamicLanguage`.

### Changes (existing surface only)
1. **Schema** (`packages/core/src/schema.ts`): allow `sensor.kind: "ast"` with `pattern` (ast-grep
   pattern string) and optional `rule` (JSON rule object for `inside`/`has`/`not`); `absent` maps to
   `not.has` semantics — document the equivalence in the field description.
2. **Core stays pure**: add `planAstSensor(sensor, target)` types only; actual matching is I/O-free
   but needs the napi binary, so the *matcher adapter* lives in `packages/mcp/src/` (imported by
   cli, same placement rule as `detectTestFrameworkForPaths`). Lazy-import `@ast-grep/napi`; if not
   installed, the sensor is **unrunnable → warn, never block** (same honesty rule as command
   sensors) and `doctor` emits an actionable `ast-engine-missing` finding.
3. **Dependency strategy**: `@ast-grep/napi` as an `optionalDependency` of `@hivelore/mcp`
   (mirrors the `@hivelore/embeddings` optional pattern; check tsup externals — see gotcha
   `2026-04-25-gotcha-tsup-externals-required`).
4. **Gate integration** (`enforce.ts runSensorGate`, `sensors.ts check`): ast sensors scan the
   FULL current content of changed files (AST needs parseable units), but a hit only fires if it
   overlaps an added line from the diff (map node range → changed line numbers) — preserves
   "fires on introduction, not on touching a file".
5. **Validation transposes unchanged** (`judgeProposedSensor` / propose path): silent on
   presumed-correct HEAD content, fires on `bad_example`, block accepted only when both hold.
   Brittleness lint: reject patterns that are pure literals with hardcoded numbers (reuse
   `sensorPatternBrittleness` on the pattern text).
6. **CLI/MCP**: `sensors propose --kind ast --pattern '<ast-grep pattern>'` (existing flags);
   `propose_sensor` input gains the `"ast"` enum value. `sensors export --format ast-grep` replaces
   the eslint export's spot as the modern path (keep grep export).
7. **Migration nudge**: `sensors list` marks regex sensors whose pattern parses as an expression
   with "consider --kind ast for structural precision" (info only, no auto-migration).

### Acceptance criteria
- A `kind: ast` block sensor `stripe.paymentIntents.create($$$)` with `not.has idempotencyKey`
  refuses a commit introducing the faulty call, stays silent on the correct call, on comments, and
  on string literals containing the same text (the regex engine's known false-positive class —
  add exactly this test).
- Without `@ast-grep/napi` installed: gate warns `ast-sensor-unrunnable`, never blocks; doctor says
  how to install.
- Full suite green; live E2E in a scratch repo with the npx-installed CLI.

---

## Phase 2 — Passive capture: finish the observe → proposed-lesson loop

**Verdict: COPY claude-mem's pipeline shape onto OUR existing infra. Zero new surface: the hook,
the JSONL, and `session-end --auto` already exist. What's missing is the last leg — failure
observations become `proposed` attempt memories instead of only a nag.**

### Inspiration mechanism
claude-mem: PostToolUse records observations passively; SessionEnd compresses them into durable
memories; no user discipline required. Its weakness (and our opening): its memories are personal
notes with no team truth-ing and no enforcement path.

### Changes (existing surface only)
1. **`hivelore observe`** (exists): extend `failure_hint` detection — currently heuristic on tool
   response; add detection for repeated-command-after-failure (same normalized Bash command within
   N observations after a failure = a retry loop worth capturing). Keep the hook contract: exit 0
   always, bounded I/O, no LLM, no network.
2. **`session-end --auto`** (exists): after synthesizing the recap, **distill clustered failures
   into `proposed` attempt memories** — deterministic templating only (what = normalized command /
   tool + first error line; why_failed = truncated error; paths = observed files). Dedup against
   the corpus (existing dedup on body hash + a lexical near-match check against recent attempts) so
   re-runs never spam. Cap: max 3 auto-drafts per session. Tag `auto-captured` so ranking can
   distinguish them and `memory list --status proposed` reviews them.
3. **Close the loop with the existing nag**: `checkFailureCapture` / `uncaptured-failures`
   (enforce.ts) and NEXT.md's "call mem_tried for each" now first point at the auto-drafts:
   "2 failure(s) auto-captured as proposed lessons — review/approve or reject" instead of asking
   the agent to re-type what the harness already saw.
4. **Autopilot boundary**: auto-drafts are NEVER auto-validated (exception to autopilot's
   auto-approve: the 72h auto-approval skips `auto-captured` memories; they require an explicit
   approve / promote). They never carry sensors. `propose_sensor` on top of one follows the normal
   validated path.
5. **Other agents**: the Claude Code hook installer exists (`claude-hooks.ts`); for agents without
   hooks, `hivelore run --` wrapper (exists) already sees stdout/exit codes — feed the same
   observation writer from the wrapper (it already wraps sessions; add the failure sniffing there).

### Acceptance criteria
- A scripted session (hook payloads piped to `hivelore observe`) containing two Bash failures +
  one retry produces, after `session-end --auto`: a recap, ≤3 `proposed` attempts tagged
  `auto-captured`, correct anchors, and NO duplicates on a second identical run.
- `enforce finish` in that repo shows the reworded finding pointing at the drafts.
- Auto-drafts never appear as `validated`, never carry a sensor, and are skipped by 72h
  auto-approve (test the autopilot exception explicitly).

---

## Phase 3 — The PR loop: review replies become proposed lessons (git-native CodeRabbit)

**Verdict: COPY CodeRabbit's learning-creation flow into our existing `ingest` + GitHub Action.
Their moat is "a reviewer reply becomes a rule applied to every future review". Ours can be
stronger: a reviewer reply becomes a *candidate deterministic gate*.**

### Inspiration mechanism
CodeRabbit: a natural-language reply on a review thread → a learning record with metadata (PR
number, filename, author) → explicit "Learnings added" ack comment → loaded into every future
review, repo/org scoped, manageable (list/edit/delete).

### Changes (existing surface only)
1. **`hivelore ingest --from github-pr <number|url>`** (new *source* on the existing command, like
   `sonar-api`): via `gh api`, pull review comments + thread replies for the PR; keep comments that
   (a) are authored by humans, and (b) match an instruction shape (imperative verbs: "never/always/
   don't/must/use X instead of Y") OR carry the explicit marker `hivelore:` anywhere in the body.
   Each kept comment → a `proposed` memory: type `convention` (or `attempt` when the comment shape
   is "this broke X"), body = quoted instruction + PR link, anchors = the file/line the thread is
   attached to, tag `review-learning`. Dry-run supported (existing flag). Dedup by thread id.
2. **GitHub Action** (`packages/github-action`, exists — it already posts relevant memories on
   PRs): add reply handling — on `issue_comment` / `pull_request_review_comment` events whose body
   starts with `/hivelore remember`, run the same ingest for that single thread and reply with an
   ack comment listing the created memory id (the "Learnings added" moment) and the exact
   `hivelore sensors propose` line if the instruction looks sensor-able (reuse
   `suggestSensorSeed`). The action only ever writes `proposed` memories via a PR-safe commit or an
   artifact + instruction (respect: agents never push to protected branches; default = the ack
   comment includes a ready-to-run local command when direct commit isn't possible).
3. **Ranking**: `review-learning` tagged memories rank via the normal classifier (they have real
   anchors, so no stack-pack-style trap; add a test proving an anchored review learning reaches
   `must_read` when its file is edited).

### Acceptance criteria
- `ingest --from github-pr` on a fixture payload (recorded `gh api` JSON, no network in tests)
  creates correctly anchored proposed memories, ignores bot comments and non-instructions, and is
  idempotent per thread.
- Live E2E once on a real PR of this repo (create a test PR, reply `/hivelore remember never use
  moment.js in src/`, run the action path manually).
- README: the three-harness table's feedback row mentions the PR loop in one line (no new section).

---

## Phase 4 — Behaviour hardening: prove the RED, contain the execution

**Verdict: MODIFY our own validation and executor. This is the branch where we already lead; these
two changes close its remaining honesty gaps.**

### Changes (existing surface only)
1. **Prove-RED option on arming** (`sensors propose --kind test` / `propose_sensor`): new optional
   input `red_ref` (a commit/ref or `--red-diff <file>` reverse patch representing the incident
   state). Validation then: (a) oracle must PASS on current tree (exists), (b) apply the incident
   state in a scratch `git worktree` — **symlink `node_modules` from the main tree into the
   worktree** (this is the documented reason the HEAD-baseline trick didn't transfer; see decision
   `2026-07-02-decision-command-sensors-behaviour-bridge`) — and the oracle must FAIL there.
   Result recorded on the sensor frontmatter as `red_proven: true` + surfaced in the prevention
   receipt (`incidentSuffix` area). Absent `red_ref`, behavior unchanged — but the acceptance
   guidance says what proving RED would add, and `doctor`'s unarmed-scaffold finding mentions it.
2. **Execution containment** (`command-sensors.ts` executor, both the CLI executor and the MCP
   validation mirror): run with a scrubbed env (allowlist: PATH, HOME, LANG, CI, NODE_*, plus a
   `HIVELORE_SENSOR` marker — drop everything else, notably cloud credentials and tokens), cwd
   pinned to repo root, existing timeout + maxBuffer kept. Document in README's honesty-rules
   paragraph: command sensors are opt-in AND env-scrubbed; full sandboxing (network/fs isolation)
   is explicitly out of scope and stays the CI runner's job.
3. **Quarantine visibility** (exists): no change — but add one test asserting a `red_proven` sensor
   that later flaps still quarantines (proving RED once must not exempt it from health tracking).

### Acceptance criteria
- E2E: arm with `red_ref` pointing at the pre-fix commit → accepted with `red_proven: true`;
  arming where the oracle also passes on the incident state → rejected `red-not-proven` with
  guidance. Worktree cleanup guaranteed (finally).
- A command sensor can no longer read an env var outside the allowlist (test: sensor command
  `printenv SECRET_X` with SECRET_X set → not visible).

---

## Phase 5 — Eval that would have caught our own bugs

**Verdict: MODIFY the existing eval. The self-synthesized eval scored 100/100 while the stack-pack
ranking bug shipped and regex sensors were once orphaned from the gate. Golden cases must come from
reality: gate misses and review learnings.**

### Changes (existing surface only)
1. **Gate-miss → labeled case** (gate-miss detection exists since v0.35): when a revert/hotfix of a
   gate-passed commit produces a draft lesson, ALSO append a labeled retrieval case (task = the
   reverted commit subject; expected = the draft lesson id) to `.ai/eval/spec.json` as
   `proposed_cases` — merged into scoring only after human approval (a `--approve-cases` pass on
   the existing eval command).
2. **Ranking regression class**: add a synthetic-but-adversarial case family to `hivelore eval`:
   for each memory tag category (stack-pack, review-learning, env-workaround), one case asserting
   its DESIGNED tier for a strong on-topic task (stack-pack → useful, env-workaround → background).
   This is exactly the family that would have caught the dead-escape-hatch bug.
3. **CI bar**: `haive-enforcement.yml` already runs eval; raise `--fail-under` only when authored
   cases ≥ 5 so fresh repos aren't punished (reuse the authored-only score split from v0.27).

### Acceptance criteria
- Reverting a gate-passed commit in a fixture repo yields a proposed eval case; approving it makes
  eval score it; the adversarial tier family fails if someone re-introduces an unconditional
  stack-pack cap (mutate the classifier in a test to prove the case catches it).

---

## Phase 6 — OPTIONAL / GATED: org scope without a server

**Do not start without Sady's explicit GO — this is the one new-surface exception.**
Verdict: REUSE git. `.ai/org/` as a read-only mounted corpus (git submodule or subtree of an
org-knowledge repo); loader already walks directories recursively; scope `org` = team semantics,
lower rank weight than repo-team, sensors from org corpus arm only as `warn` locally until promoted
per-repo. No server, no RBAC beyond the org repo's git permissions. If this proves insufficient,
THAT is the moment to discuss a service — not before.

---

## Sequencing & parallelization

- Phases **1, 2, 3, 4** are mutually independent → four agents can run them in parallel branches;
  merge order preference: 4 → 1 → 2 → 3 (4 and 1 touch the sensor spine; land them first).
- Phase **5** consumes outputs of 3 (review-learning tag) but only for one case family — it can
  start immediately and add that family last.
- Multi-agent git protocol applies (pull before, push after, lockstep bump per landing — see
  `2026-05-31-decision-git-sync-protocol-multi-agent`). One phase = one release.
- Every phase writes its decision memory and updates this spec's checklist below on completion.

## Completion checklist

- [ ] Phase 1 — AST sensors (ast-grep engine, unrunnable-honesty, validation transposed)
- [ ] Phase 2 — Passive capture distills proposed lessons (no new surface, autopilot exception)
- [ ] Phase 3 — PR loop (`ingest --from github-pr`, action `/hivelore remember`, ack)
- [ ] Phase 4 — Prove-RED + env-scrubbed executor
- [ ] Phase 5 — Eval golden set (gate-miss cases, adversarial tier family, CI bar)
- [ ] Phase 6 — (gated) org scope via git mount
