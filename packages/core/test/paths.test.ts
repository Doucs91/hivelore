import { describe, expect, it } from "vitest";
import { memoryFilePath, resolveHaivePaths } from "../src/paths.js";

describe("resolveHaivePaths", () => {
  it("resolves all standard paths under .ai/", () => {
    const p = resolveHaivePaths("/repo");
    expect(p.haiveDir).toBe("/repo/.ai");
    expect(p.projectContext).toBe("/repo/.ai/project-context.md");
    expect(p.memoriesDir).toBe("/repo/.ai/memories");
    expect(p.personalDir).toBe("/repo/.ai/memories/personal");
    expect(p.teamDir).toBe("/repo/.ai/memories/team");
    expect(p.moduleDir).toBe("/repo/.ai/memories/module");
  });
});

describe("memoryFilePath", () => {
  const p = resolveHaivePaths("/repo");

  it("places personal memories in personal/", () => {
    expect(memoryFilePath(p, "personal", "id-1")).toBe(
      "/repo/.ai/memories/personal/id-1.md",
    );
  });

  it("places team memories in team/", () => {
    expect(memoryFilePath(p, "team", "id-2")).toBe(
      "/repo/.ai/memories/team/id-2.md",
    );
  });

  it("places module memories under module/<name>/", () => {
    expect(memoryFilePath(p, "module", "id-3", "transactions")).toBe(
      "/repo/.ai/memories/module/transactions/id-3.md",
    );
  });

  it("falls back to _unscoped when module name missing", () => {
    expect(memoryFilePath(p, "module", "id-4")).toBe(
      "/repo/.ai/memories/module/_unscoped/id-4.md",
    );
  });
});
