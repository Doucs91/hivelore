import { describe, expect, it } from "vitest";
import { detectFailure, isExpectedNonzeroExit } from "../src/commands/observe.js";

describe("isExpectedNonzeroExit", () => {
  it("treats grep / pipelines / test as expected non-zero", () => {
    expect(isExpectedNonzeroExit("grep -i error file.txt")).toBe(true);
    expect(isExpectedNonzeroExit("pnpm build 2>&1 | head -15")).toBe(true);
    expect(isExpectedNonzeroExit("rg foo")).toBe(true);
    expect(isExpectedNonzeroExit("test -f x || true")).toBe(true);
    expect(isExpectedNonzeroExit("diff a b")).toBe(true);
  });
  it("does not excuse a plain failing command", () => {
    expect(isExpectedNonzeroExit("pnpm build")).toBe(false);
    expect(isExpectedNonzeroExit("node script.js")).toBe(false);
    expect(isExpectedNonzeroExit("")).toBe(false);
  });
});

describe("detectFailure", () => {
  it("does NOT flag a grep|head that exits non-zero (the false-positive case)", () => {
    const flagged = detectFailure({
      tool_name: "Bash",
      tool_input: { command: "pnpm build 2>&1 | grep -iE 'error' | head -15" },
      tool_response: { exit_code: 1 },
    });
    expect(flagged).toBe(false);
  });

  it("flags a plain command that exits non-zero", () => {
    const flagged = detectFailure({
      tool_name: "Bash",
      tool_input: { command: "node build.js" },
      tool_response: { exit_code: 1 },
    });
    expect(flagged).toBe(true);
  });

  it("flags a real error signature even inside a pipeline", () => {
    const flagged = detectFailure({
      tool_name: "Bash",
      tool_input: { command: "pnpm build | tee log" },
      tool_response: "src/x.ts: error TS2304: Cannot find name 'foo'",
    });
    expect(flagged).toBe(true);
  });
});
