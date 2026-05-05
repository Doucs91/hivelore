import { mkdtempSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  RUNTIME_JOURNAL_FILENAME,
  appendRuntimeJournalEntry,
  readRuntimeJournalTail,
} from "../src/runtime-journal.js";
import type { HaivePaths } from "../src/paths.js";
import { resolveHaivePaths } from "../src/paths.js";

describe("runtime journal", () => {
  let dir: string;
  let paths: HaivePaths;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "rj-"));
    mkdirSync(path.join(dir, ".ai", ".runtime"), { recursive: true });
    paths = resolveHaivePaths(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("append and tail round-trip", async () => {
    await appendRuntimeJournalEntry(paths, { kind: "note", message: "a" });
    await appendRuntimeJournalEntry(paths, { kind: "note", message: "b" });
    const tail = await readRuntimeJournalTail(paths, 10);
    expect(tail.map((e) => e.message)).toEqual(["a", "b"]);
    const jp = path.join(paths.runtimeDir, RUNTIME_JOURNAL_FILENAME);
    expect(readFileSync(jp, "utf8").trim().split("\n")).toHaveLength(2);
  });
});
