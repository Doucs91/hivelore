# 0.65.0 — audit fixes and upgrade guide

This release addresses five issues reproduced against the global 0.64.0 CLI.

| Issue | Changed behavior | Regression coverage |
|---|---|---|
| A long policy lost its final exception but counted as consulted | The edit hook emits an explicit unread pointer. Partial MCP/CLI briefings do not credit complete consultation. Full reads accept the hook session ID. Auto-briefing includes actual policy bodies. | CLI long-policy/session test; MCP full/compact/actions consultation tests |
| Updating templates left old merge hooks and live MCP sessions behind | Setup repairs managed automatic-sync hooks at Git's configured hooks path, preserves foreign commands, writes reviewable legacy CI candidates, and performs a fresh handshake. Runtime receipts are per process and include the legacy receipt. | Hook migration/idempotency and multi-process receipt tests |
| Legacy two-arm benchmark reports bypassed evidence checks | Every mode requires >=10 distinct tasks, >=3 repetitions, comparable model/checkout/budget/prompt metadata, outcome/evaluator attestations, and matching protocol/run manifests. | Pure evidence tests plus CLI prepared-report, manifest-tamper and missing-arm tests |
| No-op hook timings represented only `ls` | Read/no-target calls exit before CLI imports; edit handling is isolated. The diagnostic reports first edit and ten-sample median/p95 for Read, repeated Edit and two Bash paths. | Hook tests and disposable installation exercise |
| Feedback was missing from the default profile and disconnected from catches | Default MCP includes feedback. Corrected/verified outcomes require references; optional catch IDs validate identity and correction order. Reports correlate later silent sensor checks without claiming causality. | MCP feedback and core correlation/AST-ledger tests |

## Upgrade an existing installation

1. Install the new CLI when the maintainer publishes it: `npm install -g @hivelore/cli@0.65.0`.
2. Run `hivelore agent setup --no-global` in the repository. Use `--yes` only if you also intend to configure user-level clients.
3. Review any `.github/workflows/*.candidate` before replacing a legacy CI sync workflow.
4. Restart the AI client. A successful fresh diagnostic does not upgrade an existing conversation.
5. Run `hivelore agent check --exercise --json` and inspect the MCP version, live-process warnings and synthetic sensor proof.

Do not install the standalone MCP package unless needed. The CLI bundles its server; independent
`hivelore-mcp` installations can lag behind. Explicitly disabled clients remain disabled.

## Complete a long-policy read

Use `mem_get({id, session_id})`, or `hivelore memory get MEMORY_ID --session-id HOOK_SESSION_ID`.
Only a complete read in that session suppresses the unread-policy reminder. Summaries remain useful
navigation, but no longer act as proof that the exception at the end was delivered.

## Close the outcome loop

```bash
hivelore stats outcomes --json
hivelore memory feedback MEMORY_ID --outcome corrected --reference COMMIT --catch-id CATCH_ID
hivelore memory feedback MEMORY_ID --outcome verified --reference TEST_REPORT --catch-id CATCH_ID
```

`CATCH_ID` comes from the local outcome report. Correction and verification remain declared evidence.
A subsequent silent sensor evaluation is a separate local observation, with its stage, revision and
scope hash. It does not authenticate the reference or establish that the reported correction caused
that result. Local logs are diagnostic records, not signed provenance or portable evidence archives.

## Limits that remain explicit

- Hook subprocess startup still has a cost. On one local synthetic run, median Read was 61.5 ms,
  repeated Edit 171 ms, Bash read 57 ms and Bash script 58.5 ms. First Edit was 198 ms.
  These are machine-specific measurements, not latency guarantees; use the diagnostic on your repo.
- The pre-edit hook cannot infer file effects of an opaque shell script before execution. Existing
  post-tool observation can inspect actual Git changes; arbitrary shell invocations without explicit
  targets do not become policy-aware just because the fast path is quicker.
- Benchmark decision readiness is evidence completeness. Human-supplied outcomes and evaluator
  independence remain attestations. No superiority, prevented-bug count or time savings are proven.
- Persistent MCP processes need a client restart. Live PID receipts are diagnostics, not authentication.
- npm publication remains a human-maintainer action under this repository's release policy. Package
  READMEs are prepared in source and shipped with the next publication; a GitHub release alone does
  not update npm's public page.
