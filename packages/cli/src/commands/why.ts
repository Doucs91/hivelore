/**
 * `hivelore why <file[:line]>` and `hivelore ci why` — the two questions an agent asks on its own.
 *
 * Thin orchestration: git / gh / file reads here, every decision in core (`buildWhyReport`,
 * `extractCiFailureSignals`, `classifyCiAnnotation`, `relateCiFailure`). Both work read-only; `ci why`
 * needs the GitHub CLI and says so when it is missing.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import {
  collectWhyReport,
  classifyCiAnnotation,
  extractCiFailureSignals,
  onlyExitCodes,
  findProjectRoot,
  loadMemoriesFromDir,
  relateCiFailure,
  renderWhyReport,
  resolveHaivePaths,
  type CiInfraCause,
} from "@hivelore/core";
import { ui } from "../utils/ui.js";

const exec = promisify(execFile);

async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return (await exec(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })).stdout;
}

interface GhJob {
  databaseId: number;
  name: string;
  conclusion: string;
  status: string;
  steps?: Array<{ name: string; conclusion: string }>;
}

const INFRA_HINT: Record<CiInfraCause, string> = {
  billing: "the job never ran — the account's Actions billing or spending limit blocked it; nothing is wrong with the code",
  runner: "the job never got a runner — check self-hosted runners / labels; nothing is wrong with the code",
  timeout: "the job hit its time limit — a hang or a slow step, not necessarily a code failure",
  cancelled: "the run was cancelled (a newer push or a manual cancel) — re-run it",
};

export function registerWhy(program: Command): void {
  program
    .command("why <target>")
    .description(
      "Why is this code like this? <file[:line]> → the rules, sensors and checklists that guard it, doc warnings,\n" +
      "  the commit that last changed the line and the past fixes in the file. Read-only.",
    )
    .option("-d, --dir <dir>", "project root")
    .option("--json", "machine-readable output", false)
    .action(async (target: string, opts: { dir?: string; json?: boolean }) => {
      const root = findProjectRoot(opts.dir);
      const report = await collectWhyReport(root, target);
      console.log(opts.json ? JSON.stringify(report, null, 2) : renderWhyReport(report));
    });

  const ci = program.command("ci").description("Continuous-integration helpers.");
  ci
    .command("why")
    .description(
      "Why is CI red? Finds the failed run for HEAD (or the branch), extracts the failing steps, errors and tests,\n" +
      "  names infrastructure causes (billing, runners, timeouts), and links memories that saw it before. Needs `gh`.",
    )
    .option("--run <id>", "a specific workflow run id")
    .option("-d, --dir <dir>", "project root")
    .option("--json", "machine-readable output", false)
    .action(async (opts: { run?: string; dir?: string; json?: boolean }) => {
      const root = findProjectRoot(opts.dir);
      try { await run("gh", ["--version"], root); } catch {
        ui.error("`ci why` needs the GitHub CLI (`gh`), authenticated for this repository.");
        process.exitCode = 1;
        return;
      }
      try { await run("gh", ["repo", "view", "--json", "nameWithOwner"], root); } catch {
        if (opts.json) console.log(JSON.stringify({ run: null, message: "no GitHub repository gh can read for this checkout" }));
        else ui.error("`ci why`: this checkout has no GitHub repository `gh` can read (no remote, or not authenticated for it).");
        process.exitCode = 1;
        return;
      }
      let runId = opts.run;
      if (!runId) {
        const head = (await run("git", ["rev-parse", "HEAD"], root).catch(() => "")).trim();
        const branch = (await run("git", ["branch", "--show-current"], root).catch(() => "")).trim();
        const pick = async (args: string[]): Promise<string | undefined> => {
          const rows = JSON.parse(await run("gh", ["run", "list", ...args, "--limit", "20", "--json", "databaseId,conclusion,status"], root).catch(() => "[]")) as Array<{ databaseId: number; conclusion: string; status: string }>;
          return rows.find((r) => r.status === "completed" && !["success", "skipped", "neutral"].includes(r.conclusion))?.databaseId?.toString();
        };
        runId = (head ? await pick(["--commit", head]) : undefined) ?? (branch ? await pick(["--branch", branch]) : undefined);
      }
      if (!runId) {
        if (opts.json) console.log(JSON.stringify({ run: null, message: "no failed run for HEAD or this branch" }));
        else ui.success("No failed workflow run for HEAD or this branch.");
        return;
      }
      const view = JSON.parse(await run("gh", ["run", "view", runId, "--json", "jobs,workflowName,url,conclusion,headSha"], root)) as {
        jobs: GhJob[]; workflowName: string; url: string; conclusion: string; headSha: string;
      };
      const failedJobs = view.jobs.filter((j) => !["success", "skipped", "neutral"].includes(j.conclusion));
      const infra: Array<{ job: string; cause: CiInfraCause; message: string }> = [];
      let repo = "";
      try { repo = (await run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], root)).trim(); } catch { /* fork / no remote */ }
      for (const job of failedJobs) {
        const ranSteps = (job.steps ?? []).filter((s) => s.conclusion && s.conclusion !== "skipped");
        if (!repo || (ranSteps.length > 2 && job.conclusion === "failure")) continue;
        try {
          const annotations = JSON.parse(await run("gh", ["api", `repos/${repo}/check-runs/${job.databaseId}/annotations`], root)) as Array<{ message: string }>;
          for (const a of annotations) {
            const cause = classifyCiAnnotation(a.message);
            if (cause) { infra.push({ job: job.name, cause, message: a.message.slice(0, 300) }); break; }
          }
        } catch { /* annotations unavailable */ }
      }
      const log = await run("gh", ["run", "view", runId, "--log-failed"], root).catch(() => "");
      const signals = extractCiFailureSignals(log);
      // A failing step that only says "exit code 2" (a gate that reports in one step and fails in the
      // next): read the whole job log for the reason.
      for (const [i, job] of signals.jobs.entries()) {
        if (!onlyExitCodes(job)) continue;
        const ghJob = failedJobs.find((j) => j.name === job.job);
        if (!ghJob) continue;
        const full = await run("gh", ["run", "view", runId, "--job", String(ghJob.databaseId), "--log"], root).catch(() => "");
        const reasons = extractCiFailureSignals(full).jobs.flatMap((j) => j.errors).filter((e) => !/exit code \d+/i.test(e));
        if (reasons.length) signals.jobs[i] = { ...job, errors: [...reasons.slice(0, 10), ...job.errors] };
      }
      const paths = resolveHaivePaths(root);
      const memories = existsSync(paths.memoriesDir) ? (await loadMemoriesFromDir(paths.memoriesDir)).map((l) => l.memory) : [];
      const related = relateCiFailure(signals, memories);
      const result = { run: { id: runId, workflow: view.workflowName, url: view.url, conclusion: view.conclusion, head: view.headSha }, failed_jobs: failedJobs.map((j) => j.name), infra, signals, related };
      if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
      const out: string[] = [`CI ${view.workflowName} — ${view.conclusion} (${view.url})`];
      for (const i of infra) out.push("", `⚠ ${i.job}: ${INFRA_HINT[i.cause]}`, `  annotation: ${i.message}`);
      for (const job of signals.jobs) {
        out.push("", `✗ ${job.job}${job.step ? ` › ${job.step}` : ""}`);
        for (const e of job.errors) out.push(`  ${e}`);
      }
      if (signals.failing_tests.length) {
        out.push("", "Failing tests:");
        for (const t of signals.failing_tests.slice(0, 10)) out.push(`  • ${t}`);
      }
      if (related.length) {
        out.push("", "Seen before:");
        for (const r of related) out.push(`  • ${r.rule}  (${r.type} ${r.id} · shared: ${r.shared.join(", ")})`);
      }
      if (!signals.jobs.length && !infra.length) out.push("", "No error lines in the failed log — open the run for details.");
      console.log(out.join("\n"));
    });
}
