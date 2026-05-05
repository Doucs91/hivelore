import { describe, expect, it } from "vitest";
import { extractActionsBriefBody } from "../src/briefing-body.js";

describe("extractActionsBriefBody", () => {
  it("pulls bullets when present", () => {
    const md = `# Title\n\nIntro line.\n\n- Do **this** first\n- Then **that**\n- Finally check Z\n`;
    const out = extractActionsBriefBody(md, 400);
    expect(out).toContain("- Do **this** first");
    expect(out).toContain("- Then **that**");
    expect(out).not.toContain("Intro line.");
  });

  it("falls back to first paragraph when no bullets", () => {
    const md = `# H\n\nPlain paragraph explaining the trap without list syntax.`;
    const out = extractActionsBriefBody(md, 120);
    expect(out.toLowerCase()).toContain("plain paragraph");
  });
});
