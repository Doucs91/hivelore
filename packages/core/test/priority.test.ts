import { describe, expect, it } from "vitest";
import { classifyMemoryPriority, priorityRank, prioritySignals } from "../src/priority.js";

describe("classifyMemoryPriority (shared)", () => {
  it("must_read on direct anchor, symbol, or human-approval — regardless of type", () => {
    expect(classifyMemoryPriority(prioritySignals({ type: "decision", directAnchor: true }))).toBe("must_read");
    expect(classifyMemoryPriority(prioritySignals({ type: "gotcha", directSymbol: true }))).toBe("must_read");
    expect(classifyMemoryPriority(prioritySignals({ type: "convention", requiresHumanApproval: true }))).toBe("must_read");
  });

  it("must_read on an exact or strong attempt/skill hit", () => {
    expect(classifyMemoryPriority(prioritySignals({ type: "attempt", exactTaskMatch: true }))).toBe("must_read");
    expect(classifyMemoryPriority(prioritySignals({ type: "attempt", strongSemantic: true }))).toBe("must_read");
    expect(classifyMemoryPriority(prioritySignals({ type: "skill", exactTaskMatch: true }))).toBe("must_read");
  });

  it("down-ranks stack-pack and env-workaround memories to background on a soft match", () => {
    expect(classifyMemoryPriority(prioritySignals({ type: "gotcha", tags: ["stack-pack"], usefulSemantic: true }))).toBe("background");
    expect(classifyMemoryPriority(prioritySignals({ type: "attempt", tags: ["hotswap"], usefulSemantic: true }))).toBe("background");
    // but an EXACT hit on an env-workaround memory still ranks (the down-rank is for soft matches only)
    expect(classifyMemoryPriority(prioritySignals({ type: "attempt", tags: ["hotswap"], exactTaskMatch: true }))).toBe("must_read");
  });

  it("but a directly-anchored env-workaround still ranks must_read", () => {
    expect(classifyMemoryPriority(prioritySignals({ type: "attempt", tags: ["dev-workflow"], directAnchor: true }))).toBe("must_read");
  });

  it("useful on skill / module-domain / exact / useful-semantic / tag-task", () => {
    expect(classifyMemoryPriority(prioritySignals({ type: "skill" }))).toBe("useful");
    expect(classifyMemoryPriority(prioritySignals({ type: "decision", moduleOrDomainMatch: true }))).toBe("useful");
    expect(classifyMemoryPriority(prioritySignals({ type: "gotcha", exactTaskMatch: true }))).toBe("useful");
    expect(classifyMemoryPriority(prioritySignals({ type: "gotcha", usefulSemantic: true }))).toBe("useful");
    expect(classifyMemoryPriority(prioritySignals({ type: "gotcha", tagTaskMatch: true }))).toBe("useful");
  });

  it("background when nothing matched", () => {
    expect(classifyMemoryPriority(prioritySignals({ type: "gotcha" }))).toBe("background");
  });

  it("priorityRank orders the tiers", () => {
    expect(priorityRank("must_read")).toBeGreaterThan(priorityRank("useful"));
    expect(priorityRank("useful")).toBeGreaterThan(priorityRank("background"));
  });
});

describe("stack-pack rescue on STRONG task evidence", () => {
  it("a strong semantic hit (≥0.65) lifts a stack seed to useful — never must_read", () => {
    expect(
      classifyMemoryPriority(prioritySignals({ type: "convention", tags: ["stack-pack"], strongSemantic: true, usefulSemantic: true })),
    ).toBe("useful");
    expect(
      classifyMemoryPriority(prioritySignals({ type: "convention", tags: ["stack-pack"], exactTaskMatch: true })),
    ).toBe("useful");
  });

  it("weak evidence (mid semantic, tag hit) still smothers a stack seed to background", () => {
    expect(
      classifyMemoryPriority(prioritySignals({ type: "convention", tags: ["stack-pack"], usefulSemantic: true, tagTaskMatch: true })),
    ).toBe("background");
  });

  it("env workarounds keep the hard cap even on strong evidence (fix the environment instead)", () => {
    expect(
      classifyMemoryPriority(prioritySignals({ type: "gotcha", tags: ["dev-env"], strongSemantic: true, exactTaskMatch: true })),
    ).toBe("background");
  });

  it("a direct anchor still promotes a stack seed to must_read (unchanged escape hatch)", () => {
    expect(
      classifyMemoryPriority(prioritySignals({ type: "convention", tags: ["stack-pack"], directAnchor: true })),
    ).toBe("must_read");
  });
});
