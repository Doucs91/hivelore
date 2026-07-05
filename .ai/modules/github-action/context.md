# Module: github-action (`packages/github-action`)

Self-contained composite GitHub Action that surfaces repo memories on pull requests and captures explicit review-learning instructions.

## Purpose

- Match changed PR files to anchored team memories and update one idempotent review comment.
- Turn `/hivelore remember ...` review instructions into a proposed memory on a dedicated branch and pull request.

## Conventions

- Review text is untrusted data: never execute comment bodies or instructions as shell/code.
- Persistence must target `hivelore/review-learning-*` and open a PR; never write directly to the default branch.
- Keep the action runtime self-contained. Changes to `src/run.ts` require rebuilding the committed `dist/run.js` artifact.
- Tests set `HIVELORE_ACTION_TEST=1` so importing the module does not execute `main()`.
- The comment marker is stable and must preserve idempotent update behavior.

## Verification

Run `pnpm --filter hivelore-pr-memory-action test` and `pnpm --filter hivelore-pr-memory-action build`, then `pnpm check:artifacts` from the root.
