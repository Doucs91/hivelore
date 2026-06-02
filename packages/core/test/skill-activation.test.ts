import { describe, expect, it } from "vitest";
import { evaluateSkillActivation, isSkill, isSkillSuppressed } from "../src/skill-activation.js";
import type { Activation, MemoryFrontmatter } from "../src/types.js";

function fm(type: string, activation?: Partial<Activation>): Pick<MemoryFrontmatter, "type" | "activation"> {
  return {
    type: type as MemoryFrontmatter["type"],
    activation: activation
      ? { keywords: activation.keywords ?? [], globs: activation.globs ?? [], always: activation.always ?? false }
      : undefined,
  };
}

describe("evaluateSkillActivation", () => {
  it("is not applicable to non-skill memories (never suppressed)", () => {
    const r = evaluateSkillActivation(fm("gotcha"), { task: "anything" });
    expect(r.applicable).toBe(false);
    expect(r.activated).toBe(true);
    expect(isSkillSuppressed(fm("gotcha"), {})).toBe(false);
  });

  it("keeps legacy behavior for a skill with no activation block", () => {
    const r = evaluateSkillActivation(fm("skill"), { task: "x" });
    expect(r.applicable).toBe(false);
    expect(r.activated).toBe(true);
  });

  it("activates on a keyword substring of the task", () => {
    const r = evaluateSkillActivation(fm("skill", { keywords: ["Stripe"] }), { task: "add a stripe webhook" });
    expect(r.activated).toBe(true);
    expect(r.reasons).toContain("keyword:Stripe");
  });

  it("activates on a glob match against edited files", () => {
    const r = evaluateSkillActivation(fm("skill", { globs: ["src/payments/**"] }), {
      task: "unrelated",
      files: ["src/payments/charge.ts"],
    });
    expect(r.activated).toBe(true);
    expect(r.reasons.some((x) => x.startsWith("glob:"))).toBe(true);
  });

  it("activates when always=true regardless of context", () => {
    expect(evaluateSkillActivation(fm("skill", { always: true }), {}).activated).toBe(true);
  });

  it("suppresses a skill whose triggers match nothing", () => {
    const skill = fm("skill", { keywords: ["graphql"], globs: ["src/api/**"] });
    expect(isSkillSuppressed(skill, { task: "fix the css", files: ["src/ui/button.css"] })).toBe(true);
  });
});

describe("isSkill", () => {
  it("detects skill type", () => {
    expect(isSkill({ type: "skill" })).toBe(true);
    expect(isSkill({ type: "convention" })).toBe(false);
  });
});
