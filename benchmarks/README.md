# Paired agent benchmark

`paired-suite.json` defines the ten minimum tasks used for Hivelore-vs-plain runs. Each task is run
twice with the same model, prompt, checkout, limits, and failing oracle. Only the Hivelore arm receives
the repo memory/briefing. A reviewer who did not run either arm grades the final diff and records a
distinct `Evaluator ID` plus `Independent evaluation: yes` in `BENCHMARK_AGENT_REPORT.md`.

Raw agent worktrees remain under the gitignored `benchmarks/agent-benchmark/`; publish only reviewed,
redacted reports/results. `hivelore benchmark report` refuses `decision-ready` unless at least ten
complete pairs carry independent evaluator attestations.
