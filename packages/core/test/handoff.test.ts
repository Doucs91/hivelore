import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, utimes } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildHandoffMarkdown,
  handoffAgeMs,
  handoffFilePath,
  readSessionHandoff,
  writeSessionHandoff,
  HANDOFF_FILENAME,
} from "../src/handoff.js";

describe("session handoff (NEXT.md)", () => {
  const at = new Date("2026-06-06T12:00:00.000Z");

  it("builds compact markdown with focus, open threads and next steps", () => {
    const md = buildHandoffMarkdown({
      goal: "Wire the payment webhook",
      summary: "Edit ×4, Bash ×2",
      openThreads: ["mem_tried: signature check failed with raw body", ""],
      filesTouched: ["src/pay/webhook.ts"],
      nextSteps: "Add idempotency key persistence",
      diffStat: " src/pay/webhook.ts | 12 +++",
      at,
    });
    expect(md).toContain("# NEXT — session handoff");
    expect(md).toContain("## Focus\nWire the payment webhook");
    expect(md).toContain("- mem_tried: signature check failed with raw body");
    expect(md).toContain("## Next steps\nAdd idempotency key persistence");
    expect(md).toContain("`src/pay/webhook.ts`");
    expect(md).toContain("git diff --stat");
    // Empty open-thread entries are dropped, not rendered as blank bullets.
    expect(md).not.toMatch(/- *\n- *\n/);
    expect(md.endsWith("\n")).toBe(true);
  });

  it("renders placeholders when nothing is captured", () => {
    const md = buildHandoffMarkdown({ goal: "", at });
    expect(md).toContain("_(no goal captured)_");
    expect(md).toContain("## Open threads\n_None captured._");
    expect(md).toContain("## Next steps\n_None captured");
  });

  describe("I/O round-trip", () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(path.join(tmpdir(), "haive-handoff-"));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("writes NEXT.md at the repo root and reads it back", async () => {
      expect(await readSessionHandoff(dir)).toBeNull();
      const file = await writeSessionHandoff(dir, { goal: "Resume here", at });
      expect(file).toBe(handoffFilePath(dir));
      expect(path.basename(file)).toBe(HANDOFF_FILENAME);
      const onDisk = await readFile(file, "utf8");
      const read = await readSessionHandoff(dir);
      expect(read).toBe(onDisk);
      expect(read).toContain("Resume here");
    });

    it("overwrites rather than appending on a second session", async () => {
      await writeSessionHandoff(dir, { goal: "first session", at });
      await writeSessionHandoff(dir, { goal: "second session", at });
      const read = (await readSessionHandoff(dir)) ?? "";
      expect(read).toContain("second session");
      expect(read).not.toContain("first session");
    });

    it("reports null age when absent and a fresh age when present", async () => {
      expect(await handoffAgeMs(dir)).toBeNull();
      await writeSessionHandoff(dir, { goal: "x", at });
      const age = await handoffAgeMs(dir);
      expect(age).not.toBeNull();
      expect(age!).toBeGreaterThanOrEqual(0);
    });

    it("computes age relative to the provided now and file mtime", async () => {
      const file = await writeSessionHandoff(dir, { goal: "x", at });
      const mtime = new Date("2026-06-06T10:00:00.000Z");
      await utimes(file, mtime, mtime);
      const now = new Date("2026-06-06T10:00:05.000Z");
      const age = await handoffAgeMs(dir, now);
      expect(age).not.toBeNull();
      expect(Math.round(age! / 1000)).toBe(5);
      expect(existsSync(file)).toBe(true);
    });
  });
});
