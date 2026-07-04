/**
 * propose_sensor — the agent (LLM), which understands the code, PROPOSES a sensor; core VALIDATES it.
 *
 * This is the "generate via the LLM-in-the-loop, validate deterministically" half of making the
 * auto-generation layer excellent. The heuristic generator (suggestSensorFromMemory) only recognizes
 * a few shapes; an agent that has read the code can write a precise discriminating pattern. But a
 * proposal is only TRUSTED to hard-block after `judgeProposedSensor` proves it discriminates:
 *   - not brittle, and
 *   - SILENT on the current (presumed-correct) anchored code, and
 *   - FIRES on the bad example (from input, or extracted from the lesson body).
 * A rejected proposal is NOT written; the verdict tells the agent how to revise and re-propose.
 */
import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  extractSensorExamples,
  extractTestFilePathsFromCommand,
  hasPendingTestMarker,
  judgeProposedSensor,
  loadMemoriesFromDir,
  serializeMemory,
  type Sensor,
  type SensorTarget,
} from "@hivelore/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const ProposeSensorInputSchema = {
  memory_id: z.string().min(1).describe("Id of the gotcha/attempt memory this sensor protects."),
  kind: z
    .enum(["regex", "shell", "test"])
    .default("regex")
    .describe(
      "regex = pattern matched on added diff lines (default). shell|test = a COMMAND the gate runs " +
      "when the diff touches the sensor's paths — routes the team's own oracle (an existing test, an " +
      "invariant script) to this lesson. Command sensors only execute where enforcement.runCommandSensors=true.",
    ),
  pattern: z
    .string()
    .optional()
    .describe("kind=regex: regex matching the FAULTY usage (the risky call/token), e.g. 'stripe\\.paymentIntents\\.create'."),
  command: z
    .string()
    .optional()
    .describe("kind=shell|test: command to execute (e.g. 'npx vitest run tests/payments/refund.spec.ts'). Non-zero exit = the lesson fires."),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("kind=shell|test: max runtime before the executor kills the command (default 120000)."),
  absent: z
    .string()
    .optional()
    .describe(
      "Regex for the CORRECT-usage marker (e.g. 'idempotencyKey'). When it appears in the window around " +
      "a match, the catch is suppressed — this is what makes the sensor discriminate the faulty call " +
      "from the correct one. STRONGLY recommended for 'X without Y' lessons.",
    ),
  bad_example: z
    .string()
    .optional()
    .describe("A code snippet that SHOULD match — proves the sensor catches the mistake. If omitted, examples are read from the lesson body."),
  severity: z
    .enum(["warn", "block"])
    .default("block")
    .describe("block = hard-fail the gate (accepted ONLY if it passes self-validation). warn = advisory."),
  message: z.string().optional().describe("LLM-facing fix message shown when it fires. Defaults to one derived from the lesson."),
  incident: z
    .string()
    .optional()
    .describe(
      "Provenance: the real incident this sensor guards — a ticket/prod ref ('prod #442', 'INC-1029', " +
      "'2026-06 refund overcharge'). Turns 'a test failed' into 'this reproduces the incident the test " +
      "exists to prevent'. Surfaced in the block message and the prevention receipt. Strongly recommended " +
      "for command/test sensors routed from a post-incident test.",
    ),
  flags: z.string().optional().describe("Optional regex flags (e.g. 'i' for case-insensitive)."),
  paths: z
    .array(z.string())
    .default([])
    .describe("Override scope paths. Defaults to the memory's anchor paths."),
};

export type ProposeSensorInput = {
  [K in keyof typeof ProposeSensorInputSchema]: z.infer<(typeof ProposeSensorInputSchema)[K]>;
};

export interface ProposeSensorOutput {
  accepted: boolean;
  memory_id: string;
  severity: "warn" | "block";
  /** Set when rejected — why, and how to revise. */
  reason?: string;
  guidance?: string;
  self_check: {
    silent_on_current: boolean;
    fires_on_bad: boolean | null;
    fired_on: string[];
  };
  file_path?: string;
}

function deriveMessage(body: string, pattern: string, absent?: string): string {
  const instead = body.match(/\*\*Instead,\s*use:\*\*\s*([^\n]+)/i)?.[1]?.trim();
  if (absent) {
    const base = `${pattern} without ${absent}`;
    return instead ? `${base} — ${instead}` : `${base} — add the required companion.`;
  }
  const heading = body
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .find((l) => l.length > 0 && !l.startsWith("---"));
  return heading?.slice(0, 180) || `Avoid ${pattern}.`;
}

/**
 * Read the PRESUMED-CORRECT contents of anchored files for sensor self-checks.
 *
 * "Silent on current" must test the last COMMITTED state (HEAD), not the working tree: an agent
 * typically proposes a sensor right after hitting the failure, while the bad pattern is still
 * sitting uncommitted in the anchored file — validating against the working tree then rejects
 * every honest proposal with fires-on-current. HEAD already passed the gate, so it is the
 * presumed-correct baseline; fall back to the working tree for files not yet in git.
 */
export async function readPresumedCorrectTargets(
  root: string,
  relPaths: string[],
): Promise<SensorTarget[]> {
  const targets: SensorTarget[] = [];
  for (const rel of relPaths) {
    try {
      // "./" keeps the path relative to cwd even if the project root is a git subdirectory.
      const content = execSync(`git show ${JSON.stringify(`HEAD:./${rel}`)}`, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
      targets.push({ path: rel, content });
      continue;
    } catch { /* not in HEAD or not a git repo — fall back to the working tree */ }
    const abs = path.resolve(root, rel);
    if (!existsSync(abs)) continue;
    try {
      targets.push({ path: rel, content: await readFile(abs, "utf8") });
    } catch { /* unreadable — skip */ }
  }
  return targets;
}

/**
 * Minimal validation runner for command sensors (mirrors the CLI executor's classification —
 * the dependency direction is cli→mcp, so the full executor can't be imported here).
 */
function runCommandForValidation(
  command: string,
  root: string,
  timeoutMs = 120_000,
): { status: "passed" | "failed" | "unrunnable"; detail: string } {
  try {
    execSync(`bash -c ${JSON.stringify(command)}`, {
      cwd: root,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: "passed", detail: "exit 0" };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { status?: number; killed?: boolean; stdout?: Buffer; stderr?: Buffer };
    const out = `${e.stdout?.toString() ?? ""}\n${e.stderr?.toString() ?? ""}`.split("\n").filter(Boolean).slice(-8).join("\n");
    if (e.killed) return { status: "unrunnable", detail: `timed out after ${timeoutMs}ms` };
    if (e.status === 127 || e.status === 126 || e.code === "ENOENT") {
      return { status: "unrunnable", detail: e.status === 126 ? "command found but not executable" : "command not found" };
    }
    return { status: "failed", detail: out || `exit ${e.status ?? "?"}` };
  }
}

export async function proposeSensor(
  input: ProposeSensorInput,
  ctx: HaiveContext,
): Promise<ProposeSensorOutput> {
  if (!existsSync(ctx.paths.memoriesDir)) {
    throw new Error(`No .ai/memories at ${ctx.paths.root}. Run 'hivelore init' first.`);
  }

  const kind = input.kind ?? "regex";
  if (kind === "regex") {
    if (!input.pattern) {
      return {
        accepted: false,
        memory_id: input.memory_id,
        severity: input.severity,
        reason: "invalid-regex",
        guidance: "kind=regex requires a `pattern`.",
        self_check: { silent_on_current: false, fires_on_bad: null, fired_on: [] },
      };
    }
    // Validate the regex(es) compile before anything else.
    try {
      new RegExp(input.pattern, input.flags ?? "");
      if (input.absent) new RegExp(input.absent, input.flags ?? "");
    } catch (err) {
      return {
        accepted: false,
        memory_id: input.memory_id,
        severity: input.severity,
        reason: "invalid-regex",
        guidance: `The pattern or absent regex does not compile: ${String(err)}`,
        self_check: { silent_on_current: false, fires_on_bad: null, fired_on: [] },
      };
    }
  } else if (!input.command?.trim()) {
    return {
      accepted: false,
      memory_id: input.memory_id,
      severity: input.severity,
      reason: "invalid-command",
      guidance: "kind=shell|test requires a `command` (the check the gate will execute).",
      self_check: { silent_on_current: false, fires_on_bad: null, fired_on: [] },
    };
  }

  const loaded = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const found = loaded.find(({ memory }) => memory.frontmatter.id === input.memory_id);
  if (!found) {
    throw new Error(`No memory found with id ${input.memory_id}`);
  }

  // A sensor on a personal (gitignored) memory only guards THIS machine — the lesson would still
  // repeat on every other clone and in CI. Nudge promotion whenever an accepted sensor lands on one.
  const personalScopeNudge =
    found.memory.frontmatter.scope === "personal"
      ? ` Note: this lesson is personal-scoped, so the sensor guards only YOUR machine (personal memories are gitignored). Promote it so the gate travels with the repo: hivelore memory promote ${input.memory_id}.`
      : "";

  // ── Command sensors: the oracle must PASS on the presumed-correct current tree ──
  // (the behaviour analogue of "silent on current"). A failing oracle would block every
  // commit; an unrunnable one proves nothing. Both reject `block`; warn is advisory.
  if (kind !== "regex") {
    // A STILL-PENDING oracle (it.todo / skip stub) passes on anything — arming it as `block`
    // would report protection that does not exist. Refuse until the assertion is written.
    const referencedTests = extractTestFilePathsFromCommand(input.command!.trim())
      .filter((rel) => existsSync(path.resolve(ctx.paths.root, rel)));
    const pendingTests: string[] = [];
    for (const rel of referencedTests) {
      try {
        if (hasPendingTestMarker(await readFile(path.resolve(ctx.paths.root, rel), "utf8"))) pendingTests.push(rel);
      } catch { /* unreadable — let the command run speak for itself */ }
    }
    if (pendingTests.length > 0 && input.severity === "block") {
      return {
        accepted: false,
        memory_id: input.memory_id,
        severity: input.severity,
        reason: "oracle-pending",
        guidance:
          `The routed test is still a PENDING stub (${pendingTests.join(", ")}) — it passes on anything, so the ` +
          "sensor would enforce nothing while reporting protection. Write the assertion (RED on the incident, " +
          "GREEN once fixed), run it, then re-propose.",
        self_check: { silent_on_current: false, fires_on_bad: null, fired_on: pendingTests },
      };
    }
    const verdictCmd = runCommandForValidation(input.command!.trim(), ctx.paths.root, input.timeout_ms);
    const anchorPathsCmd = input.paths.length > 0 ? input.paths : found.memory.frontmatter.anchor.paths;
    if (verdictCmd.status !== "passed" && input.severity === "block") {
      return {
        accepted: false,
        memory_id: input.memory_id,
        severity: input.severity,
        reason: verdictCmd.status === "unrunnable" ? "command-unrunnable" : "fails-on-current",
        guidance:
          verdictCmd.status === "unrunnable"
            ? `The command could not run (${verdictCmd.detail}). Fix the command (or timeout_ms), then re-propose.`
            : "The command FAILS on the current tree — the presumed-correct state must pass, or the gate would " +
              "block every commit. Revert the faulty diff (or fix the check), then re-propose. " +
              `Output tail:\n${verdictCmd.detail}`,
        self_check: { silent_on_current: false, fires_on_bad: null, fired_on: anchorPathsCmd },
      };
    }
    const sensorCmd: Sensor = {
      kind,
      command: input.command!.trim(),
      ...(input.timeout_ms ? { timeout_ms: input.timeout_ms } : {}),
      paths: anchorPathsCmd,
      message: input.message?.trim() || deriveMessage(found.memory.body, input.command!.trim(), undefined),
      ...(input.incident?.trim() ? { incident: input.incident.trim() } : {}),
      severity: input.severity,
      autogen: false,
      last_fired: null,
    };
    const nextCmd = {
      frontmatter: { ...found.memory.frontmatter, sensor: sensorCmd },
      body: found.memory.body,
    };
    await writeFile(found.filePath, serializeMemory(nextCmd), "utf8");
    return {
      accepted: true,
      memory_id: input.memory_id,
      severity: input.severity,
      guidance:
        (verdictCmd.status === "passed"
          ? "Command oracle passes on the current tree; the gate now runs it when the diff touches the sensor's paths (requires enforcement.runCommandSensors=true)."
          : `Accepted at warn severity, but note: ${verdictCmd.status} on the current tree (${verdictCmd.detail}).`) +
        (pendingTests.length > 0
          ? ` Note: the routed test is still a PENDING stub (${pendingTests.join(", ")}) — it passes on anything; write the assertion to make this oracle real.`
          : "") +
        personalScopeNudge,
      self_check: { silent_on_current: verdictCmd.status === "passed", fires_on_bad: null, fired_on: [] },
    };
  }

  const anchorPaths = input.paths.length > 0 ? input.paths : found.memory.frontmatter.anchor.paths;
  const currentTargets = await readPresumedCorrectTargets(ctx.paths.root, anchorPaths);

  const badExamples = [
    ...(input.bad_example ? [input.bad_example] : []),
    ...extractSensorExamples(found.memory.body),
  ];

  const sensor: Sensor = {
    kind: "regex",
    pattern: input.pattern!,
    ...(input.absent ? { absent: input.absent } : {}),
    ...(input.flags ? { flags: input.flags } : {}),
    paths: anchorPaths,
    message: input.message?.trim() || deriveMessage(found.memory.body, input.pattern!, input.absent),
    ...(input.incident?.trim() ? { incident: input.incident.trim() } : {}),
    severity: input.severity,
    autogen: false, // deliberately authored by the agent and validated — higher trust than heuristic
    last_fired: null,
  };

  const verdict = judgeProposedSensor(sensor, { currentTargets, badExamples });
  const self_check = {
    silent_on_current: verdict.self_check.silent_on_current,
    fires_on_bad: verdict.self_check.fires_on_bad,
    fired_on: verdict.self_check.fired_on,
  };

  if (!verdict.accepted) {
    const guidance =
      verdict.reason === "fires-on-current"
        ? `The sensor matches the CURRENT (correct) code in ${verdict.self_check.fired_on.join(", ")}. Add or tighten the 'absent' companion so correct usage is excluded, then re-propose.`
        : verdict.reason === "missed-bad-example"
          ? "The sensor did not match the bad example, so it won't catch the mistake. Adjust the pattern to match the faulty code, then re-propose."
          : verdict.reason === "brittle"
            ? `The pattern is brittle (${verdict.brittle}). Use a durable pattern (avoid hardcoded line numbers), then re-propose.`
            : "Re-propose with a discriminating pattern.";
    return {
      accepted: false,
      memory_id: input.memory_id,
      severity: input.severity,
      reason: verdict.reason ?? "rejected",
      guidance,
      self_check,
    };
  }

  // Accepted — persist the sensor onto the memory frontmatter.
  const next = {
    frontmatter: { ...found.memory.frontmatter, sensor },
    body: found.memory.body,
  };
  await writeFile(found.filePath, serializeMemory(next), "utf8");

  return {
    accepted: true,
    memory_id: input.memory_id,
    severity: input.severity,
    ...(personalScopeNudge ? { guidance: personalScopeNudge.trim() } : {}),
    self_check,
    file_path: found.filePath,
  };
}
