import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveHaivePaths } from "@hivelore/core";
import { manualSessionStart, normalizeAnchorPath } from "../src/commands/session-end.js";

describe("normalizeAnchorPath", () => {
  const root = "/home/user/projects/my-app";

  it("returns a relative path unchanged", () => {
    expect(normalizeAnchorPath(root, "src/utils.ts")).toBe("src/utils.ts");
  });

  it("converts an absolute path inside the root to relative", () => {
    expect(normalizeAnchorPath(root, "/home/user/projects/my-app/src/utils.ts")).toBe(
      "src/utils.ts",
    );
  });

  it("converts nested absolute path to relative", () => {
    expect(
      normalizeAnchorPath(root, "/home/user/projects/my-app/packages/cli/src/index.ts"),
    ).toBe("packages/cli/src/index.ts");
  });

  it("keeps absolute paths outside the root unchanged", () => {
    const external = "/home/user/other-repo/src/file.ts";
    expect(normalizeAnchorPath(root, external)).toBe(external);
  });

  it("keeps empty string unchanged", () => {
    expect(normalizeAnchorPath(root, "")).toBe("");
  });

  it("handles root-level file", () => {
    expect(normalizeAnchorPath(root, "/home/user/projects/my-app/package.json")).toBe(
      "package.json",
    );
  });

  it("handles already-relative dotfile paths", () => {
    expect(normalizeAnchorPath(root, ".gitignore")).toBe(".gitignore");
  });

  it("converts absolute dotfile to relative", () => {
    expect(normalizeAnchorPath(root, "/home/user/projects/my-app/.gitignore")).toBe(
      ".gitignore",
    );
  });
});

describe("manualSessionStart", () => {
  it("uses the latest briefing marker as the prevention receipt boundary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hivelore-session-start-"));
    const paths = resolveHaivePaths(root);
    const usageDir = path.join(paths.haiveDir, ".usage");
    await mkdir(usageDir, { recursive: true });
    await writeFile(path.join(usageDir, "tool-usage.jsonl"), [
      JSON.stringify({ tool: "get_briefing", at: "2026-01-01T00:00:00.000Z" }),
      JSON.stringify({ tool: "mem_save", at: "2026-01-01T00:10:00.000Z" }),
      JSON.stringify({ tool: "get_briefing", at: "2026-01-01T00:20:00.000Z" }),
      "",
    ].join("\n"));
    await expect(manualSessionStart(paths)).resolves.toBe("2026-01-01T00:20:00.000Z");
  });
});
