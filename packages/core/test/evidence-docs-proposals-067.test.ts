import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFrontmatter,
  deriveConfidence,
  distinctiveEditTokens,
  emptyUsage,
  findDocCaveats,
  hasCaveatLanguage,
  isDocCandidatePath,
  migrateLegacyCache,
  parseUnifiedDiff,
  proposeCaptures,
  repoCacheKey,
  resolveCacheDir,
  resolveHaivePaths,
  suggestScope,
  type Memory,
  type Sensor,
} from "../src/index.js";

function memory(type: Memory["frontmatter"]["type"], slug: string, overrides: Partial<Memory["frontmatter"]> = {}, body = "# T\n\nBody."): Memory {
  const fm = buildFrontmatter({ type, slug, scope: "team", status: "validated" });
  return { frontmatter: { ...fm, ...overrides }, body };
}

describe("docs-aware caveats (field report #9 §1, #11 §9)", () => {
  const docs = [
    {
      path: "docs/security.md",
      content: [
        "# Security",
        "",
        "## Content Security Policy",
        "",
        "The policy lives in `frontend/src/security/csp.ts`.",
        "",
        "Enforcing `worker-src 'self'` would break the PDF viewer: pdf.js spawns its worker from a blob URL,",
        "and the refusal happens inside the worker, so headless CI never sees it.",
        "",
        "```",
        "frontend/src/security/csp.ts — never matched inside a fence",
        "```",
      ].join("\n"),
    },
    { path: "docs/architecture.md", content: "# Architecture\n\nThe CSP builder is in src/security/csp.ts and is unit tested.\n" },
    { path: "README.md", content: "# App\n\nNothing about security here.\n" },
  ];

  it("surfaces the warning that names a key the edit touches, with its doc location", () => {
    const result = findDocCaveats(docs, { files: ["frontend/src/security/csp.ts"], keys: ["worker-src"] });
    expect(result.caveats).toHaveLength(1);
    expect(result.caveats[0]).toMatchObject({ doc: "docs/security.md", line: 7, heading: "Content Security Policy", target: "worker-src", via: "key" });
    expect(result.caveats[0]!.text).toContain("would break the PDF viewer");
  });

  it("turns a plain mention into a pointer, never into caveat text", () => {
    const result = findDocCaveats(docs, { files: ["frontend/src/security/csp.ts"] });
    expect(result.caveats).toEqual([]);
    // The suffix match (docs drop the monorepo prefix) still yields a pointer, one per doc.
    expect(result.mentions.map((m) => m.doc).sort()).toEqual(["docs/architecture.md", "docs/security.md"]);
  });

  it("treats warnings under a heading that names the file as about that file", () => {
    const result = findDocCaveats(
      [{ path: "docs/deploy.md", content: "# Deploy\n\n## deploy/nginx.conf\n\nNever reload with `-s reload` during a release: it is silently ignored.\n" }],
      { files: ["deploy/nginx.conf"] },
    );
    expect(result.caveats).toHaveLength(1);
    expect(result.caveats[0]).toMatchObject({ via: "heading", target: "deploy/nginx.conf" });
  });

  it("ignores generic basenames and keys outside warnings", () => {
    const result = findDocCaveats(
      [{ path: "docs/x.md", content: "Never edit index.ts by hand.\n\nThe worker-src directive is documented by MDN.\n" }],
      { files: ["src/index.ts"], keys: ["worker-src"] },
    );
    expect(result.caveats).toEqual([]);
    expect(result.mentions).toEqual([]);
  });

  it("selects docs, not logs or generated bridges", () => {
    expect(isDocCandidatePath("docs/runbook.md")).toBe(true);
    expect(isDocCandidatePath("packages/web/README.md")).toBe(true);
    expect(isDocCandidatePath("ARCHITECTURE.md")).toBe(true);
    expect(isDocCandidatePath("CHANGELOG.md")).toBe(false);
    expect(isDocCandidatePath("CLAUDE.md")).toBe(false);
    expect(isDocCandidatePath(".ai/memories/team/x.md")).toBe(false);
    expect(isDocCandidatePath("src/notes.md")).toBe(false);
    expect(hasCaveatLanguage("> [!WARNING]\n> rotate the key first")).toBe(true);
    expect(hasCaveatLanguage("The builder returns a string.")).toBe(false);
  });

  it("lifts compound config keys from an edit, not prose words", () => {
    const tokens = distinctiveEditTokens("headers['Content-Security-Policy'] = \"worker-src 'self'; script-src x\"; const value = 1;");
    expect(tokens).toEqual(expect.arrayContaining(["Content-Security-Policy", "worker-src", "script-src"]));
    expect(tokens).not.toContain("value");
  });
});

describe("falsifiable evidence (field report #9 §9.3)", () => {
  const now = new Date("2026-11-06T00:00:00Z");
  const base = { status: "validated" as const, created_at: "2026-11-01T00:00:00Z", verified_at: "2026-11-01T00:00:00Z" };

  it("authoritative needs both what verified it and what that could not see", () => {
    const fm = { ...buildFrontmatter({ type: "decision", slug: "csp" }), ...base, validated_by: "human" as const, evidence: "tested" as const };
    expect(deriveConfidence(fm, emptyUsage(), undefined, now)).toBe("trusted");
    expect(deriveConfidence({ ...fm, verified_by: "e2e suite (headless)" }, emptyUsage(), undefined, now)).toBe("trusted");
    expect(deriveConfidence({ ...fm, verified_by: "e2e suite (headless)", cannot_detect: "GPU-only render path" }, emptyUsage(), undefined, now))
      .toBe("authoritative");
  });

  it("an auto-validated claim stays low until it names what reproduced it", () => {
    const fm = { ...buildFrontmatter({ type: "gotcha", slug: "x" }), ...base, validated_by: "auto" as const, evidence: "tested" as const };
    expect(deriveConfidence(fm, emptyUsage(), undefined, now)).toBe("low");
    expect(deriveConfidence({ ...fm, verified_by: "regression test csp.test.ts" }, emptyUsage(), undefined, now)).toBe("trusted");
  });

  it("round-trips through buildFrontmatter", () => {
    const fm = buildFrontmatter({ type: "decision", slug: "y", verifiedBy: " 7 days of reports ", cannotDetect: "worker refusals" });
    expect(fm.verified_by).toBe("7 days of reports");
    expect(fm.cannot_detect).toBe("worker refusals");
  });
});

describe("capture proposals (field reports #8 §6, #9 §7/§9.4, #11)", () => {
  const regex = (pattern: string, paths: string[]): Sensor => ({
    kind: "regex", pattern, paths, message: "Pass the business ZoneId.", severity: "block", autogen: false, last_fired: null,
  });

  it("links a regression fix to the decision that justified the code", () => {
    const decision = memory("decision", "enforce-csp", { anchor: { paths: ["frontend/src/security/csp.ts"], symbols: [] }, verified_by: "7 days without reports" });
    const proposals = proposeCaptures({
      commits: [{ sha: "abcdef1234", subject: "fix(csp): restore pdf worker", body: "Broken since #412: worker-src blocked the blob worker.", files: ["frontend/src/security/csp.ts"] }],
      diff: [],
      memories: [decision],
    });
    const link = proposals.find((p) => p.kind === "incident-link");
    expect(link?.memory_id).toBe(decision.frontmatter.id);
    expect(link?.commands[0]).toContain("--cannot-detect");
    expect(link?.commands[1]).toContain("--kind checklist --paths frontend/src/security/csp.ts");
  });

  it("spots a bug class fixed outside the sensor's scope", () => {
    const sensor = memory("gotcha", "zone", { sensor: regex("LocalDate\\.now\\(\\)|new Date\\(\\)", ["backend/**"]) });
    const diff = parseUnifiedDiff([
      "diff --git a/frontend/src/slots.test.ts b/frontend/src/slots.test.ts",
      "--- a/frontend/src/slots.test.ts",
      "+++ b/frontend/src/slots.test.ts",
      "@@ -3 +3 @@",
      "-  const today = new Date();",
      "+  const today = zonedNow('Europe/Paris');",
    ].join("\n"));
    const proposals = proposeCaptures({ commits: [], diff, memories: [sensor] });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ kind: "sensor-scope-gap", memory_id: sensor.frontmatter.id });
    expect(proposals[0]!.commands[0]).toContain("--sensor-paths backend/**,frontend/**");
  });

  it("does not call a moved pattern a fix", () => {
    const sensor = memory("gotcha", "zone2", { sensor: regex("new Date\\(\\)", ["backend/**"]) });
    const proposals = proposeCaptures({
      commits: [],
      diff: [{ path: "frontend/a.ts", removed: ["const d = new Date();"], added: ["  const d = new Date();"] }],
      memories: [sensor],
    });
    expect(proposals).toEqual([]);
  });

  it("proposes a gotcha from a fix commit that explains its cause, unless a memory covers it", () => {
    const commit = {
      sha: "1234567890", subject: "fix: reload nginx after cert renewal",
      body: "The reload was silently ignored because the pid file moved to /run/nginx.pid in the new image.",
      files: ["deploy/renew.sh", "pnpm-lock.yaml"],
    };
    const fresh = proposeCaptures({ commits: [commit], diff: [], memories: [] });
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ kind: "fix-lesson", type: "gotcha", paths: ["deploy/renew.sh"] });
    expect(fresh[0]!.rule).toContain("silently ignored because the pid file moved");

    const existing = memory("gotcha", "nginx-pid", { anchor: { paths: ["deploy/renew.sh"], symbols: [] } }, "# Nginx reload silently ignored\n\nThe pid file moved; reload nginx explicitly.");
    expect(proposeCaptures({ commits: [commit], diff: [], memories: [existing] })).toEqual([]);
    // A fix that already ships its memory in the same commit needs nothing more.
    expect(proposeCaptures({ commits: [{ ...commit, files: [...commit.files, ".ai/memories/team/x.md"] }], diff: [], memories: [] })).toEqual([]);
  });

  it("ignores a fix commit with no stated cause", () => {
    expect(proposeCaptures({ commits: [{ sha: "a", subject: "fix: typo", body: "", files: ["src/a.ts"] }], diff: [], memories: [] })).toEqual([]);
  });

  it("suggests a container-aware scope", () => {
    expect(suggestScope("frontend/src/a.ts")).toBe("frontend/**");
    expect(suggestScope("packages/web/src/a.ts")).toBe("packages/web/**");
  });
});

describe("cache outside the repo (field report #11 §8)", () => {
  it("defaults to the user cache directory, keyed per checkout", () => {
    const root = "/work/my repo";
    const dir = resolveCacheDir(root, { XDG_CACHE_HOME: "/xdg" } as NodeJS.ProcessEnv);
    if (process.platform !== "win32") expect(dir).toBe(path.join("/xdg", "hivelore", repoCacheKey(root)));
    expect(repoCacheKey(root)).toMatch(/^my-repo-[0-9a-f]{12}$/);
    expect(repoCacheKey("/work/other/my repo")).not.toBe(repoCacheKey(root));
  });

  it("honours HIVELORE_CACHE_DIR: relative stays in the repo, absolute is a base", () => {
    expect(resolveCacheDir("/r", { HIVELORE_CACHE_DIR: ".ai/.cache" } as NodeJS.ProcessEnv)).toBe(path.resolve("/r", ".ai/.cache"));
    expect(resolveCacheDir("/r", { HIVELORE_CACHE_DIR: "/c" } as NodeJS.ProcessEnv)).toBe(path.join("/c", repoCacheKey("/r")));
  });

  it("moves a legacy .ai/.cache once, then is a no-op", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "hv-cache-"));
    const legacy = path.join(root, ".ai", ".cache");
    mkdirSync(path.join(legacy, "embeddings"), { recursive: true });
    writeFileSync(path.join(legacy, ".gitignore"), "*\n");
    writeFileSync(path.join(legacy, "usage.json"), "{\"a\":1}");
    const paths = { ...resolveHaivePaths(root), cacheDir: path.join(mkdtempSync(path.join(os.tmpdir(), "hv-user-")), "repo-key") };
    const first = migrateLegacyCache(paths);
    expect(first).toMatchObject({ migrated: true, how: "renamed" });
    expect(readFileSync(path.join(paths.cacheDir, "usage.json"), "utf8")).toBe("{\"a\":1}");
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(path.join(paths.cacheDir, ".gitignore"))).toBe(false);
    expect(migrateLegacyCache(paths)).toEqual({ migrated: false });
  });
});

describe("cache location from the repo config", () => {
  it("reads cacheDir from .ai/hivelore.config.json when no env var is set", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "hv-cfg-"));
    mkdirSync(path.join(root, ".ai"), { recursive: true });
    writeFileSync(path.join(root, ".ai", "hivelore.config.json"), JSON.stringify({ cacheDir: ".ai/.cache" }));
    expect(resolveCacheDir(root, {} as NodeJS.ProcessEnv)).toBe(path.resolve(root, ".ai/.cache"));
    expect(resolveCacheDir(root, { HIVELORE_CACHE_DIR: "/c" } as NodeJS.ProcessEnv)).toBe(path.join("/c", repoCacheKey(root)));
  });
});

describe("small field-review fixes (2026-09-30 §3.6, §3.7; 2026-09-28 §6.2)", () => {
  it("names memories after the local calendar date and transliterates accents", async () => {
    const { newMemoryId } = await import("../src/index.js");
    const late = new Date(2026, 8, 29, 23, 30); // local time, whatever the machine's zone
    expect(newMemoryId("decision", "Décision prix éco", late)).toBe("2026-09-29-decision-decision-prix-eco");
  });

  it("finds the initialised root from a subfolder that holds a stray .ai/", async () => {
    const { findProjectRoot } = await import("../src/index.js");
    const root = mkdtempSync(path.join(os.tmpdir(), "hv-root-"));
    mkdirSync(path.join(root, ".ai", "memories"), { recursive: true });
    mkdirSync(path.join(root, "frontend", ".ai", ".cache"), { recursive: true });
    mkdirSync(path.join(root, "frontend", "src"), { recursive: true });
    expect(findProjectRoot(path.join(root, "frontend", "src"))).toBe(root);
  });
});

describe("sensor weakening is judged on values, not on YAML layout", () => {
  const folded = [
    "---", "id: 2026-07-05-convention-x", "scope: team", "type: convention", "status: validated",
    "created_at: '2026-07-05T06:40:10.996Z'", "anchor:", "  paths: [package.json]", "  symbols: []",
    "sensor:", "  kind: shell", "  command: >-", "    node -e \"process.exit(0)\"", "    && true",
    "  message: >-", "    Keep the verify chain", "    intact.", "  severity: block", "  autogen: false", "  last_fired: null",
    "---", "# X", "",
  ].join("\n");
  const unfolded = [
    "---", "id: 2026-07-05-convention-x", "scope: team", "type: convention", "status: validated",
    "anchor:", "  paths:", "    - package.json", "  symbols: []",
    "sensor:", "  kind: shell", "  command: node -e \"process.exit(0)\" && true",
    "  message: Keep the verify chain intact.", "  severity: block",
    "created_at: '2026-07-05T06:40:10.996Z'", "---", "# X", "",
  ].join("\n");

  it("treats a canonical rewrite as the same sensor, and a real edit as a change", async () => {
    const { sameParsedSensor } = await import("../src/index.js");
    expect(sameParsedSensor(folded, unfolded)).toBe(true);
    expect(sameParsedSensor(folded, unfolded.replace("&& true", "&& false"))).toBe(false);
    expect(sameParsedSensor(folded, unfolded.replace("severity: block", "severity: warn"))).toBe(false);
    expect(sameParsedSensor(folded, "not a memory")).toBe(false);
  });
});

describe("incident links stay precise (dogfooding on the 0.67 branch)", () => {
  const decision = memory("decision", "pnpm-workspaces", { anchor: { paths: ["package.json", "src/app.ts"], symbols: [] } });

  it("ignores a feature commit that merely mentions the word regression", () => {
    expect(proposeCaptures({
      commits: [{ sha: "f1", subject: "feat: capture from signals", body: "Lists regression fixes touching justified code.", files: ["src/app.ts"] }],
      diff: [], memories: [decision],
    })).toEqual([]);
  });

  it("never treats a version manifest as the code a decision justified", () => {
    expect(proposeCaptures({
      commits: [{ sha: "f2", subject: "fix: release regression", body: "Broken since v1.2.", files: ["package.json"] }],
      diff: [], memories: [decision],
    })).toEqual([]);
  });

  it("keeps a targeted regression fix, and a revert", () => {
    const fix = proposeCaptures({
      commits: [{ sha: "f3", subject: "fix: app crash", body: "Root cause: the regression came from the cache change.", files: ["src/app.ts"] }],
      diff: [], memories: [decision],
    });
    expect(fix.map((p) => p.kind)).toEqual(["incident-link"]);
    const revert = proposeCaptures({
      commits: [{ sha: "f4", subject: "Revert \"feat: new cache\"", body: "", files: ["src/app.ts"] }],
      diff: [], memories: [decision],
    });
    expect(revert.map((p) => p.kind)).toEqual(["incident-link"]);
  });
});
