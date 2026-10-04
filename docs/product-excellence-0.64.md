# Product improvements in 0.64

This release addresses twelve priorities from the repository's field reports. Most reports describe
Ovanori sessions; they are useful adoption evidence, not an independent customer sample.

| Priority | Delivered behavior | Verification |
| --- | --- | --- |
| Git and CI neutrality | Briefings and feedback do not promote/rewrite shared memories. Merge hooks do not synchronize the corpus. Generated health CI has read-only repository permissions and no commit/push step. | MCP corpus immutability and generated-workflow tests |
| Effective integration | `agent check` performs a real MCP briefing. Project Claude configuration is portable. Nested package manifests no longer hide the enclosing Hivelore repository. | MCP setup, integration exercise and root-discovery tests |
| Targeted context | Edit hooks deliver up to three applicable rules within a 300-token estimate, with source and evidence. Oversized instructions become source pointers and are not counted as consulted. | Hook/context and complete-instruction tests |
| Task completion | New repositories default to local completion; read, local, commit and release remain selectable. Existing repository policies are preserved. Deferred checks are explicitly incomplete. | Completion and initialization tests |
| Fast hooks | Successful simple read commands take a lightweight entry path before the CLI/MCP dependency graph is loaded. Compound commands and errors use the full path. | Hook latency tests and measured diagnostic exercise |
| Compaction continuity | Session-local emission receipts can be reset independently. Resume/compaction preserves the original task baseline and restores available checkpoints. MCP accepts `session_id` and `context_reset`. | CLI compaction and MCP session-isolation tests |
| Short capture | `memory save "lesson" --files path` infers a gotcha without mandatory type or boilerplate. New repositories save drafts and avoid automatic recaps. | Capture regression test |
| Trustworthy claims | Reading and reporting application do not make claims true. Verification shows exceptions by default, does not validate prose, and structurally resolves qualified Java members. | Verification, corpus immutability and Java field tests |
| Incident to protection | Existing one-shot attempt/sensor capture and fix-derived proposals retain the GREEN/RED validation contract. The onboarding exercise runs the actual proposal, good diff and bad diff paths. | Sensor suites and isolated harness proof |
| Outcome accounting | `stats outcomes` separates deliveries, reported applications, rejections, corrections and verification from sensor catches. No time savings are inferred. | Outcome aggregation and feedback tests |
| Fair comparisons | `benchmark prepare` creates rotated three-arm repeated runs: good AGENTS.md, retrieval, retrieval plus gates. Three-arm reporting requires matched metadata and independent outcomes before marking evidence complete. | Benchmark preparation/evidence tests |
| Five-minute proof | `agent check --exercise` checks MCP, context injection, GREEN/RED gating and no-op latency in an isolated temporary repository. | End-to-end diagnostic test |

## Try the integrated proof

```bash
hivelore agent check --exercise --json
hivelore memory save "Use minor units: this service handles XOF." --files src/payment.ts
hivelore stats outcomes --json
```

The exercise creates and deletes its own temporary Git repository. It validates an explicitly synthetic
rule; it does not demonstrate production ROI or access from every existing editor session. Its latency
numbers describe the current machine and ten no-op samples, not a cross-platform performance claim.

Use `memory feedback <id> --applied` or `--rejected --reason "..."` for explicit utility feedback.
Use `--outcome corrected|verified --reference <commit-or-report>` for a reported result. A reference
is a provenance pointer, not an automatically authenticated proof. Local events live under `.ai/.runtime/`.

## Adoption and migration

- Existing completion defaults, explicit disabled clients and custom transports remain intact.
- Newly generated bridge files contain navigation and enforced sensors, without rotating memory
  breadcrumbs by default. Opt into `bridges sync --max-memories` to embed them.
- Reinitializing a legacy auto-writing workflow writes a `.candidate` for review and retains the
  original workflow; custom CI is never silently replaced. This repository's workflow is migrated.
- Project `.mcp.json` is portable and no longer added to ignore patterns by new initialization.
  Review any older ignore entry before sharing it. Global client configurations remain machine-local.
- New projects use draft capture, local completion and session handoffs. Existing validated memories
  and explicitly configured maintenance behavior are retained. `sync` remains an explicit maintenance action.
- npm publication remains a human-maintainer step in this repository.

## Evidence still to collect

The release supplies runnable mechanisms and regression coverage. It does not supply completed paid
model runs, blind human evaluations, or independent customer deployments. Execute the benchmark
protocol in `benchmarks/README.md` and collect multi-repository adoption outcomes before claiming a
productivity advantage. A complete report is not a statistical significance test.
