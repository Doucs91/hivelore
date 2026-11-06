import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFrontmatter,
  canonicalMemoryBody,
  deriveRuleLine,
  ensurePersonalMemoriesIgnored,
  failureIntent,
  isProductionCodeFile,
  memoryRuleLine,
  parseMemory,
  resolveHaivePaths,
  sanitizeFailureSummary,
  serializeMemory,
  sessionIdFromEnv,
  signalFailures,
  snapshotContent,
  taskDirtyFiles,
  type TaskSession,
} from "../src/index.js";

describe("session identity (field reports #10 §3, #11 §1, §6)", () => {
  it("reads Claude Code's CLAUDE_CODE_SESSION_ID, which the hooks' session_id matches", () => {
    expect(sessionIdFromEnv({ CLAUDE_CODE_SESSION_ID: "abc-123" })).toBe("abc-123");
  });
  it("keeps explicit Hivelore ids first", () => {
    expect(sessionIdFromEnv({ HIVELORE_SESSION_ID: "mine", CLAUDE_CODE_SESSION_ID: "theirs" })).toBe("mine");
  });
  it("returns undefined rather than a shared 'default' when nothing names the session", () => {
    expect(sessionIdFromEnv({})).toBeUndefined();
  });
});

describe("task ownership ignores HEAD moves (field report #11 §1)", () => {
  const session = (baseline: Record<string, string>): TaskSession => ({
    version: 1, root: "/r", branch: "develop", head: "aaa", started_at: new Date().toISOString(),
    baseline, observed: baseline,
  });

  it("a file dirty at start and byte-identical at finish is pre-existing, even if its status/index changed", () => {
    const state = session({ "wip.ts": " M:100644 old 0:sha-wip" });
    // A pull moved HEAD: the index column differs, the bytes do not.
    expect(taskDirtyFiles(state, { "wip.ts": " M:100644 new 0:sha-wip" })).toEqual([]);
  });

  it("a later edit to the same file makes it owned", () => {
    const state = session({ "wip.ts": " M:100644 old 0:sha-wip" });
    expect(taskDirtyFiles(state, { "wip.ts": " M:100644 old 0:sha-edited" })).toEqual(["wip.ts"]);
  });

  it("a file not dirty at start is owned", () => {
    expect(taskDirtyFiles(session({}), { "new.ts": "??::sha-new" })).toEqual(["new.ts"]);
  });

  it("extracts the content part of large/other fingerprints, which contain colons", () => {
    expect(snapshotContent(" M:100644 x 0:large:900:1700000000")).toBe("large:900:1700000000");
  });
});

describe("canonical write path (field report #10 §1, §2)", () => {
  const longPath = "backend/src/main/resources/db/migration/some/rather/long/directory/V23__a_long_file_name.sql";

  it("never folds long scalars", () => {
    const fm = buildFrontmatter({ type: "gotcha", slug: "x", scope: "team", paths: [longPath] });
    const raw = serializeMemory({ frontmatter: fm, body: "# X\n\nBody" });
    expect(raw).toContain(`- ${longPath}`);
    expect(raw).not.toMatch(/>-\s*$/m);
  });

  it("writes the heading at save time, so no later repair edits a committed file", () => {
    const fm = buildFrontmatter({ type: "gotcha", slug: "flyway-no-modify", scope: "team" });
    const raw = serializeMemory({ frontmatter: fm, body: "Never edit an applied migration." });
    const parsed = parseMemory(raw);
    expect(parsed.body).toBe("# Gotcha Flyway No Modify\n\nNever edit an applied migration.");
    // Idempotent: re-serializing the parsed memory changes nothing.
    expect(serializeMemory(parsed)).toBe(raw);
  });

  it("keeps an existing heading untouched", () => {
    expect(canonicalMemoryBody("2026-01-01-gotcha-x", "## Already titled\n\nbody")).toBe("## Already titled\n\nbody");
  });

  it("round-trips the new rule and source fields", () => {
    const fm = buildFrontmatter({
      type: "decision", slug: "prices", scope: "team",
      rule: "When changing a price, update both the display setting and the provider price id.",
      source: "docs/billing/runbook.md#change-a-price",
    });
    const parsed = parseMemory(serializeMemory({ frontmatter: fm, body: "# Prices\n\nLong story." }));
    expect(parsed.frontmatter.rule).toBe(fm.rule);
    expect(parsed.frontmatter.source).toBe(fm.source);
  });
});

describe("rule line (field reports #11 §5, #12 §4.2)", () => {
  it("prefers the explicit rule field", () => {
    const memory = { frontmatter: { rule: "Do X, because Y." } as never, body: "# T\n\nContext first." };
    expect(memoryRuleLine(memory)).toBe("Do X, because Y.");
  });

  it("finds the instruction line instead of the opening context", () => {
    const body = "# Webhook\n\nWe moved to the new provider in March, after a long evaluation.\n\n**Instead:** register the endpoint with `--raw-body` or signatures fail.";
    expect(deriveRuleLine(body)).toBe("register the endpoint with `--raw-body` or signatures fail.");
  });

  it("reads the first line under an instruction heading", () => {
    const body = "# Deploy\n\nSome background.\n\n## How to apply\n\n- Reload the proxy with `nginx -s reload` after every config write.";
    expect(deriveRuleLine(body)).toBe("Reload the proxy with `nginx -s reload` after every config write.");
  });

  it("falls back to the first substantive sentence", () => {
    expect(deriveRuleLine("# T\n\nPrices live in two places. The second is the provider id.")).toBe("Prices live in two places.");
  });
});

describe("failure signal bar (field reports #10 §5, #12 §3.2)", () => {
  const f = (summary: string) => ({ ts: "2026-11-01T00:00:00Z", tool: "Bash", summary });

  it("drops exploratory one-offs and keeps repeats or failing builds", () => {
    const kept = signalFailures([
      f("Bash: grep -rn foo src"),
      f("Bash: head -5 x"),
      f("Bash: curl https://example.com"),
      f("Bash: pnpm test"),
      f("Bash: ./deploy.sh staging"),
      f("Bash: ./deploy.sh staging"),
    ]);
    expect(kept.map((x) => x.summary)).toEqual(["Bash: pnpm test", "Bash: ./deploy.sh staging", "Bash: ./deploy.sh staging"]);
  });

  it("strips local paths and session ids", () => {
    const s = sanitizeFailureSummary("Bash: cat /tmp/claude-1000/home-x/d52a00c1-e939-4e07-ad9d-a00c5a0d181b/out.log");
    expect(s).not.toContain("/tmp/");
    expect(s).not.toContain("d52a00c1");
  });

  it("names a lesson by intent, not by the raw command line", () => {
    expect(failureIntent("Bash: pnpm --filter @x/cli test -- --run /home/me/x")).toBe("pnpm @x/cli test");
  });
});

describe("main code areas exclude docs and assets (field reports #9 §2, #11)", () => {
  it("docs/ is never a main code area", () => {
    expect(isProductionCodeFile("docs/site/src/index.ts")).toBe(false);
    expect(isProductionCodeFile("public/vendor.js")).toBe(false);
    expect(isProductionCodeFile("src/app.ts")).toBe(true);
  });
});

describe("personal memories are never committable (field report #8 §2)", () => {
  it("writes a self-contained .gitignore in the personal directory", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "hivelore-personal-"));
    const paths = resolveHaivePaths(root);
    await ensurePersonalMemoriesIgnored(paths);
    const gi = path.join(paths.personalDir, ".gitignore");
    expect(existsSync(gi)).toBe(true);
    expect(readFileSync(gi, "utf8")).toMatch(/^\*$/m);
  });
});
