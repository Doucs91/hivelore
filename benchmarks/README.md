# Repeated agent comparison

Prepare three comparable arms from the same checkout:

```bash
hivelore benchmark prepare --suite benchmarks/paired-suite.json --model YOUR_MODEL --repeats 3 --budget 50000 --out benchmarks/agent-benchmark
```

The command prepares a balanced order, per-run metadata and empty outcome templates. It does not
execute agents or spend model credits. Keep the source, task, domain knowledge, tests, model, tools
and budget equal. The plain arm receives a good AGENTS.md and local search; context adds retrieval;
haive adds validated gates. Do not give one arm secret domain knowledge unavailable to the others.

Run each entry of `protocol.json` in an isolated checkout. Reset process state between runs. Record
the actual model, checkout, token budget, task-prompt hash, human interventions, runner telemetry
and complete outcomes in `BENCHMARK_AGENT_REPORT.md`. Prompt hash identifies the common task,
not the different arm setup. Never expose held-out acceptance oracles to the agent.

A blind reviewer distinct from the runner grades final diffs. Three-arm reports require at least ten
distinct tasks with three complete repetitions, matched execution metadata and independent evaluator
attestations to reach `decision-ready`. Legacy two-arm reports remain supported under their existing
completeness threshold; they do not isolate retrieval from enforcement.

```bash
hivelore benchmark report --dir benchmarks/agent-benchmark --out RESULTS.md
```

`decision-ready` denotes completeness of reported evidence, not authenticated telemetry or statistical
superiority. Publish per-task results, variability, failures and interventions, not just an average.
Raw worktrees remain gitignored; publish only reviewed, redacted reports. A written report's token
estimate measures report length, not model billing. No comparative advantage is established until
these runs and independent evaluations have actually been performed.
