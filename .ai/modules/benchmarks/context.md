# Module: benchmarks

Evidence fixtures for paired Hivelore-versus-plain agent runs. This directory is not a product package and its reports must remain auditable rather than promotional.

## Purpose

- Keep paired task fixtures comparable: same task, model family, verification command, and outcome schema.
- Record correctness, tests, policy violations, duration, and total tokens for both groups.
- Feed `hivelore benchmark report`; do not hand-edit generated conclusions into stronger claims.

## Conventions

- A comparison is `decision-ready` only with at least 10 paired tasks and complete outcome fields.
- Smaller samples are pilots and must be labelled `insufficient`; they may describe observations but cannot establish an advantage.
- Never include fixture `node_modules`, caches, or generated runtime state in evidence.

## Verification

Run `hivelore benchmark report --dir benchmarks --json` and inspect `evidence_grade`, `paired_tasks`, and completeness before citing results.
