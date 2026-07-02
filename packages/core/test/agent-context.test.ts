import { describe, expect, it } from "vitest";
import { detectAgentContext } from "../src/agent-context.js";

describe("detectAgentContext", () => {
  it("reports human for a plain shell environment", () => {
    const ctx = detectAgentContext({ HOME: "/home/x", PATH: "/usr/bin" });
    expect(ctx.agent).toBe(false);
    expect(ctx.signals).toEqual([]);
  });

  it("detects Claude Code via CLAUDECODE", () => {
    const ctx = detectAgentContext({ CLAUDECODE: "1" });
    expect(ctx.agent).toBe(true);
    expect(ctx.signals.join(",")).toContain("claude-code");
  });

  it("detects the hivelore run wrapper via HAIVE_SESSION_ID", () => {
    const ctx = detectAgentContext({ HAIVE_SESSION_ID: "abc-123" });
    expect(ctx.agent).toBe(true);
    expect(ctx.signals.join(",")).toContain("hivelore-run-wrapper");
  });

  it("dedupes signals when both Claude Code vars are present", () => {
    const ctx = detectAgentContext({ CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli" });
    expect(ctx.agent).toBe(true);
    expect(ctx.signals).toHaveLength(2); // distinct env names, same label — both listed for debugging
  });

  it("HAIVE_AGENT=1 opts in even with no known harness", () => {
    expect(detectAgentContext({ HAIVE_AGENT: "1" })).toEqual({ agent: true, signals: ["HAIVE_AGENT=1"] });
    expect(detectAgentContext({ HAIVE_AGENT: "true" }).agent).toBe(true);
  });

  it("HAIVE_AGENT=0 force-overrides to human even inside a harness", () => {
    const ctx = detectAgentContext({ HAIVE_AGENT: "0", CLAUDECODE: "1" });
    expect(ctx.agent).toBe(false);
    expect(ctx.signals).toEqual(["HAIVE_AGENT=0"]);
  });

  it("ignores empty-string signal values", () => {
    expect(detectAgentContext({ CLAUDECODE: "", CURSOR_AGENT: "  " }).agent).toBe(false);
  });
});
