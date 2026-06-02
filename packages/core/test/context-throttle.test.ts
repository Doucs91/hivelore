import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  resolveHaivePaths,
  hashProjectContext,
  projectContextRecentlyEmitted,
  recordProjectContextEmission,
  PROJECT_CONTEXT_THROTTLE_MS,
} from "../src/index.js";

describe("project-context throttle", () => {
  it("omits an unchanged context within the window, re-emits after it or on change", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "haive-throttle-"));
    try {
      const paths = resolveHaivePaths(root);
      const hash = hashProjectContext("# Project context\n\nsome body");

      // First emission: nothing recorded yet.
      expect(await projectContextRecentlyEmitted(paths, hash)).toBe(false);
      await recordProjectContextEmission(paths, hash);

      // Within the window: same content is throttled.
      expect(await projectContextRecentlyEmitted(paths, hash)).toBe(true);

      // Changed content (different hash) is never throttled.
      expect(await projectContextRecentlyEmitted(paths, hashProjectContext("changed body"))).toBe(false);

      // Past the window: re-emit.
      const future = Date.now() + PROJECT_CONTEXT_THROTTLE_MS + 1000;
      expect(await projectContextRecentlyEmitted(paths, hash, future)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
