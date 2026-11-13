import { describe, expect, it } from "vitest";
import {
  auditInstructionRules,
  buildFrontmatter,
  buildWhyReport,
  classifyCiAnnotation,
  commandPattern,
  commandTextForGuards,
  correctionNudge,
  detectUserCorrection,
  extractCiFailureSignals,
  matchCommandGuards,
  nextPin,
  pinVerdict,
  planRuleArming,
  proposeCaptures,
  relateCiFailure,
  renderHiveloreSkill,
  renderWhyReport,
  suggestSensorExclude,
  type Memory,
  type Sensor,
} from "../src/index.js";

function memory(type: Memory["frontmatter"]["type"], slug: string, overrides: Partial<Memory["frontmatter"]> = {}, body = "# T\n\nBody."): Memory {
  const fm = buildFrontmatter({ type, slug, scope: "team", status: "validated" });
  return { frontmatter: { ...fm, ...overrides }, body };
}

describe("developer corrections become rule offers", () => {
  it("recognises a lasting rule stated while correcting the agent", () => {
    expect(detectUserCorrection("No — we never call the payment API from the controller. Use PaymentService.")).toMatchObject({ strength: "correction" });
    expect(detectUserCorrection("Je t'ai déjà dit : on n'utilise jamais moment.js ici, utilise date-fns.")?.strength).toBe("repeat");
    expect(detectUserCorrection("In this repo, migrations are append-only — never edit a shipped one.")?.rule).toContain("In this repo");
  });

  it("ignores one-off instructions, questions and politeness", () => {
    expect(detectUserCorrection("No, the other file please.")).toBeNull();
    expect(detectUserCorrection("Don't forget to run the tests.")).toBeNull();
    expect(detectUserCorrection("Do we never use moment here?")).toBeNull();
    expect(detectUserCorrection("No problem, thanks!")).toBeNull();
    expect(detectUserCorrection("Add a retry to the webhook handler.")).toBeNull();
  });

  it("offers, never instructs an install, in a repo without Hivelore", () => {
    const correction = detectUserCorrection("Stop. We always use pnpm in this project, never npm.")!;
    expect(correctionNudge(correction, false)).toContain("never install it without a yes");
    expect(correctionNudge(correction, true)).toContain("hivelore memory add --type convention");
  });

  it("turns a recorded correction into a capture candidate unless a memory already says it", () => {
    const corrections = [{ rule: "We never call the payment API from the controller, use PaymentService.", at: "2026-11-06T10:00:00Z", strength: "correction" as const }];
    const fresh = proposeCaptures({ commits: [], diff: [], memories: [], corrections });
    expect(fresh[0]).toMatchObject({ kind: "user-correction", type: "convention" });
    const known = memory("convention", "payment-service", {}, "# Payments\n\nNever call the payment API from a controller; go through PaymentService.");
    expect(proposeCaptures({ commits: [], diff: [], memories: [known], corrections })).toEqual([]);
  });
});

describe("command guards deny forbidden agent commands", () => {
  const guard = (pattern: string, severity: "warn" | "block" = "block"): Memory =>
    memory("convention", "no-npm-publish", {
      sensor: { kind: "command", pattern, paths: [], message: "Publication goes through the release workflow.", severity, autogen: false, last_fired: null } as Sensor,
    });

  it("matches the command, through options, but not a quoted mention", () => {
    const g = guard(commandPattern("npm publish"));
    expect(matchCommandGuards("npm publish --access public", [g])).toHaveLength(1);
    expect(matchCommandGuards("cd pkg && npm publish", [g])).toHaveLength(1);
    expect(matchCommandGuards('git commit -m "never run npm publish"', [g])).toEqual([]);
    expect(matchCommandGuards("echo 'npm publish is forbidden'", [g])).toEqual([]);
    expect(matchCommandGuards("git commit -F - <<'EOF'\nnpm publish is CI-only\nEOF", [g])).toEqual([]);
    expect(matchCommandGuards('bash -c "npm publish"', [g])).toHaveLength(1);
    expect(matchCommandGuards("npm publish-dry", [g])).toEqual([]);
  });

  it("strips heredocs and message arguments only", () => {
    expect(commandTextForGuards("gh pr create --body \"npm publish\" && npm publish")).toContain("&& npm publish");
  });
});

describe("rules arm plans checks from prose", () => {
  const audit = auditInstructionRules([{
    path: "CLAUDE.md",
    content: [
      "- NEVER run `npm publish` from an agent.",
      "- Do not use `git push --tags`; push only the new tag.",
      "- Never call `LocalDate.now()` without a zone.",
      "- Never edit `db/migrations/V1__init.sql` after it shipped.",
      "- Always use `pnpm` for scripts.",
      "- Never use `any` in production code.",
    ].join("\n"),
  }], []);

  it("arms commands, protected paths and code tokens; explains what it skips", () => {
    const { plans, skipped } = planRuleArming(audit.rules);
    const byKind = Object.fromEntries(plans.map((p) => [p.bad_example, p.kind]));
    expect(byKind).toMatchObject({ "npm publish": "command", "git push --tags": "command", "LocalDate.now()": "regex", "db/migrations/V1__init.sql": "checklist" });
    const tags = plans.find((p) => p.bad_example === "git push --tags")!;
    expect(new RegExp(tags.pattern!).test("git push --tags")).toBe(true);
    expect(new RegExp(tags.pattern!).test("git push origin v1.2.3")).toBe(false);
    expect(skipped.map((s) => s.rule.text)).toEqual(expect.arrayContaining([
      expect.stringContaining("Always use"),
      expect.stringContaining("`any`"),
    ]));
  });
});

describe("why: what the repo knows about a line", () => {
  it("ranks exact anchors, shows sensors matching the line, doc warnings and past fixes", () => {
    const gotcha = memory("gotcha", "zone", {
      anchor: { paths: ["src/slots.ts"], symbols: [] },
      rule: "Always pass the business ZoneId to LocalDate.now().",
      cannot_detect: "tests run in UTC",
      sensor: { kind: "regex", pattern: "LocalDate\\.now\\(\\)", paths: ["src/**"], message: "Pass the ZoneId.", severity: "block", autogen: false, last_fired: null },
    });
    const area = memory("convention", "src-style", { anchor: { paths: ["src"], symbols: [] }, rule: "Keep services pure." });
    const report = buildWhyReport({
      file: "src/slots.ts", line: 12, lineText: "const today = LocalDate.now();",
      memories: [area, gotcha],
      docs: [{ path: "docs/time.md", content: "# Time\n\nNever use `LocalDate.now()` without a zone in `src/slots.ts`.\n" }],
      blame: { sha: "abc12345", subject: "feat: slots" },
      history: [{ sha: "def67890", subject: "fix: DST bug in slots" }, { sha: "abc12345", subject: "feat: slots" }],
    });
    expect(report.memories.map((m) => m.match)).toEqual(["exact", "area"]);
    expect(report.memories[0]!.blind_spot).toBe("tests run in UTC");
    expect(report.sensors[0]).toMatchObject({ line_matches: true });
    expect(report.doc_caveats[0]?.doc).toBe("docs/time.md");
    expect(report.fixes.map((f) => f.sha)).toEqual(["def67890"]);
    expect(renderWhyReport(report)).toContain("← this line matches");
  });
});

describe("ci why", () => {
  const log = [
    "build-and-test\tRun tests\t2026-11-06T17:28:47.89Z \u001b[31m×\u001b[39m slots > keeps the business zone 12ms",
    "build-and-test\tRun tests\t2026-11-06T17:28:47.90Z AssertionError: expected '2026-03-29' to be '2026-03-30'",
    "build-and-test\tRun tests\t2026-11-06T17:28:47.91Z Found 0 errors.",
    "build-and-test\tRun tests\t2026-11-06T17:28:48.00Z ##[error]Process completed with exit code 1.",
    "lint\tRun lint\t2026-11-06T17:28:48.00Z ##[error]Process completed with exit code 2.",
  ].join("\n");

  it("keeps the signal lines and names the failing tests", () => {
    const signals = extractCiFailureSignals(log);
    const tests = signals.jobs.find((j) => j.job === "build-and-test")!;
    expect(tests.errors.some((e) => e.startsWith("AssertionError"))).toBe(true);
    expect(tests.errors.some((e) => /0 errors/.test(e))).toBe(false);
    expect(signals.jobs.find((j) => j.job === "lint")?.errors[0]).toContain("exit code 2");
    expect(signals.failing_tests).toEqual(["slots > keeps the business zone"]);
  });

  it("names jobs that never ran and links memories that saw it before", () => {
    expect(classifyCiAnnotation("The job was not started because recent account payments have failed or your spending limit needs to be increased.")).toBe("billing");
    expect(classifyCiAnnotation("The job has exceeded the maximum execution time of 360 minutes.")).toBe("timeout");
    const dst = memory("gotcha", "dst-tests", {}, "# DST\n\nslots tests break around the business zone change: compute dates with the business zone.");
    expect(relateCiFailure(extractCiFailureSignals(log), [dst])[0]?.id).toBe(dst.frontmatter.id);
  });
});

describe("false positives and pinned versions", () => {
  it("suggests the narrowest exclude", () => {
    expect(suggestSensorExclude("src/a.test.ts")).toBe("**/*.{test,spec}.*");
    expect(suggestSensorExclude("packages/x/__fixtures__/data.ts")).toBe("**/__fixtures__/**");
    expect(suggestSensorExclude("src/legacy/old.ts")).toBe("src/legacy/old.ts");
  });

  it("only an older CLI needs action, and the pin never goes down", () => {
    expect(pinVerdict("0.67.4", "0.68.0")).toBe("older");
    expect(pinVerdict("0.68.1", "0.68.0")).toBe("newer");
    expect(pinVerdict("0.68.0", undefined)).toBe("unpinned");
    expect(nextPin("0.69.0", "0.68.0")).toBe("0.69.0");
    expect(nextPin("0.67.0", "0.68.0")).toBe("0.68.0");
  });
});

describe("agent skill", () => {
  it("describes situations, carries a name, and never asks to install without consent", () => {
    const skill = renderHiveloreSkill();
    expect(skill).toMatch(/^---\nname: hivelore\ndescription: .+\n---/);
    expect(skill).toContain("never\n  install anything without a yes");
  });
});

describe("rules arm only arms what the prohibition names (dogfooding on this repo's CLAUDE.md)", () => {
  it("never blocks the command a rule instructs, nor a token from a different clause", () => {
    const audit = auditInstructionRules([{
      path: "CLAUDE.md",
      content: [
        "5. `git push` code and the new tag (`git push && git push origin vX.Y.Z`). Do not use `git push --tags` — it tries to push every local tag.",
        "- Immediately when an approach fails, call `mem_tried` — do not wait until the end of the session.",
      ].join("\n"),
    }], []);
    const { plans } = planRuleArming(audit.rules);
    expect(plans).toHaveLength(1);
    const re = new RegExp(plans[0]!.pattern!);
    expect(re.test("git push --tags")).toBe(true);
    expect(re.test("git push")).toBe(false);
    expect(re.test("git push origin v1.2.3")).toBe(false);
  });
});

describe("forward-compatible sensors", () => {
  it("keeps a memory whose sensor kind is newer than this CLI, and writes the sensor back unchanged", async () => {
    const { parseMemory, serializeMemory } = await import("../src/index.js");
    const raw = [
      "---", "id: 2026-11-06-convention-future", "scope: team", "type: convention", "status: validated",
      "created_at: '2026-11-06T10:00:00.000Z'", "anchor:", "  paths: []", "  symbols: []",
      "sensor:", "  kind: telepathy", "  pattern: x", "  message: from the future", "  severity: block",
      "---", "# Future", "", "Body.",
    ].join("\n");
    const memory = parseMemory(raw);
    expect(memory.frontmatter.sensor).toBeUndefined();
    expect(memory.frontmatter.unsupported_sensor).toMatchObject({ kind: "telepathy" });
    const again = parseMemory(serializeMemory({ ...memory, frontmatter: { ...memory.frontmatter, tags: ["edited"] } }));
    expect(again.frontmatter.unsupported_sensor).toMatchObject({ kind: "telepathy", message: "from the future" });
  });
});

describe("ci why reads the reason a gate printed before failing", () => {
  it("keeps Hivelore's '(error):' findings and flags exit-code-only steps", async () => {
    const { extractCiFailureSignals, onlyExitCodes } = await import("../src/index.js");
    const failed = extractCiFailureSignals("gate\tFail when blocked\t2026-11-06T17:28:48Z ##[error]Process completed with exit code 2.");
    expect(onlyExitCodes(failed.jobs[0]!)).toBe(true);
    const full = extractCiFailureSignals("gate\tReport\t2026-11-06T17:28:48Z - **sensor-weakened** (error): This diff weakens the enforcement surface");
    expect(full.jobs[0]!.errors[0]).toContain("sensor-weakened");
    expect(onlyExitCodes(full.jobs[0]!)).toBe(false);
  });
});

describe("dogfooding round 2: prohibitions must be prohibitions, enforcement must be specific", () => {
  it("does not read 'code you do not understand' as a ban, and arms an unenforced npm publish boundary", () => {
    const audit = auditInstructionRules([{
      path: "CLAUDE.md",
      content: [
        "- Before changing code you do not understand: `why` (MCP) or `hivelore why <file>:<line>`.",
        "**BOUNDARY: agents NEVER run `npm publish` (or `pnpm publish`) locally — publication goes through the `release` workflow.**",
      ].join("\n"),
    }], [{ id: "x-release-chain", message: "Root verify is the release chain", pattern: "publish:all", severity: "block" }]);
    const boundary = audit.rules.find((r) => r.text.includes("BOUNDARY"))!;
    expect(boundary.class).toBe("checkable");
    const { plans } = planRuleArming(audit.rules);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.kind).toBe("command");
    const re = new RegExp(plans[0]!.pattern!);
    expect(re.test("npm publish --access public")).toBe(true);
    expect(re.test("pnpm publish")).toBe(true);
  });
});

describe("command patterns tolerate options before the subcommand", () => {
  it("catches pnpm --filter … publish, not neighbours", () => {
    const re = new RegExp(commandPattern("pnpm publish"));
    expect(re.test("pnpm --filter @hivelore/core publish --access public")).toBe(true);
    expect(re.test("pnpm -r publish")).toBe(true);
    expect(re.test("pnpm publish")).toBe(true);
    expect(re.test("pnpm run publish:all")).toBe(false);
    expect(new RegExp(commandPattern("git push --tags")).test("git push --tags")).toBe(true);
    expect(new RegExp(commandPattern("git push --tags")).test("git push origin v1")).toBe(false);
  });
});

describe("end-to-end campaign fixes", () => {
  it("a guard tells the agent the reason, not just the ban", async () => {
    const { prohibitionStatement } = await import("../src/index.js");
    expect(prohibitionStatement("NEVER run `npm publish` from an agent — releases go through CI.")).toBe("NEVER run `npm publish` from an agent — releases go through CI.");
    expect(prohibitionStatement("`git push` the tag. Do not use `git push --tags` — it pushes every local tag.")).toBe("Do not use `git push --tags` — it pushes every local tag.");
    expect(prohibitionStatement("Do not use X — use Y instead.")).toBe("Do not use X");
  });

  it("an incident link points at the decision, not at a gotcha that shares the file", () => {
    const gotcha = memory("gotcha", "raw-date", { anchor: { paths: ["src/charge.ts"], symbols: [] } });
    expect(proposeCaptures({ commits: [{ sha: "c1", subject: "fix: regression in charge", body: "", files: ["src/charge.ts"] }], diff: [], memories: [gotcha] })
      .filter((p) => p.kind === "incident-link")).toEqual([]);
  });

  it("an in-repo cache recreated after the move is folded into the user cache and removed", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const pathMod = await import("node:path");
    const { migrateLegacyCache, resolveHaivePaths } = await import("../src/index.js");
    const root = fs.mkdtempSync(pathMod.join(os.tmpdir(), "hv-merge-"));
    const userCache = fs.mkdtempSync(pathMod.join(os.tmpdir(), "hv-user-"));
    fs.writeFileSync(pathMod.join(userCache, "usage.json"), "{\"new\":true}");
    fs.mkdirSync(pathMod.join(root, ".ai", ".cache"), { recursive: true });
    fs.writeFileSync(pathMod.join(root, ".ai", ".cache", "usage.json"), "{\"old\":true}");
    fs.writeFileSync(pathMod.join(root, ".ai", ".cache", "observations.jsonl"), "{}\n");
    const paths = { ...resolveHaivePaths(root), cacheDir: userCache };
    expect(migrateLegacyCache(paths).migrated).toBe(true);
    expect(fs.existsSync(pathMod.join(root, ".ai", ".cache"))).toBe(false);
    expect(fs.readFileSync(pathMod.join(userCache, "usage.json"), "utf8")).toBe("{\"new\":true}");
    expect(fs.existsSync(pathMod.join(userCache, "observations.jsonl"))).toBe(true);
  });
});
