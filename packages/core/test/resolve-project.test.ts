import path from "node:path";
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolveProjectInfo } from "../src/resolve-project.js";

describe("resolveProjectInfo", () => {
  it("uses HAIVE_PROJECT_ROOT when set", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "haive-rp-"));
    mkdirSync(path.join(dir, ".ai"), { recursive: true });
    const sub = mkdtempSync(path.join(dir, "nested-"));
    mkdirSync(path.join(dir, ".git"), { recursive: true });
    try {
      const info = resolveProjectInfo({
        cwd: sub,
        env: {
          HAIVE_PROJECT_ROOT: dir,
        } as Record<string, string>,
      });
      expect(info.explicit_root).toBe(true);
      expect(info.resolved_root).toBe(dir);
      expect(info.haive_dir_exists).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
