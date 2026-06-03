import { describe, expect, it } from "vitest";
import {
  draftsFromFindings,
  filterNewDrafts,
  findingToDraft,
  normalizeFindingSeverity,
  parseEslintJson,
  parseFindings,
  parseNpmAudit,
  parseSarif,
  parseSonar,
  type Finding,
} from "../src/findings.js";

const SARIF = JSON.stringify({
  version: "2.1.0",
  runs: [
    {
      tool: { driver: { name: "ESLint" } },
      results: [
        {
          ruleId: "no-eval",
          level: "error",
          message: { text: "eval can be harmful." },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "src/danger.ts" },
                region: { startLine: 12, snippet: { text: "const x = eval(input)" } },
              },
            },
          ],
        },
        {
          ruleId: "no-eval",
          level: "warning",
          message: { text: "another eval." },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "src/danger.ts" },
                region: { startLine: 40 },
              },
            },
          ],
        },
      ],
    },
  ],
});

const SONAR = JSON.stringify({
  issues: [
    {
      rule: "typescript:S1234",
      severity: "MAJOR",
      message: "Refactor this function to reduce its Cognitive Complexity.",
      component: "myproj:src/big.ts",
      line: 88,
      type: "CODE_SMELL",
    },
    {
      rule: "typescript:S5852",
      impacts: [{ severity: "HIGH" }],
      message: "Make sure this regex cannot lead to denial of service.",
      component: "myproj:src/regex.ts",
      line: 5,
    },
  ],
});

describe("normalizeFindingSeverity", () => {
  it("maps tool-specific strings to the shared scale", () => {
    expect(normalizeFindingSeverity("BLOCKER")).toBe("blocker");
    expect(normalizeFindingSeverity("error")).toBe("critical");
    expect(normalizeFindingSeverity("warning")).toBe("major");
    expect(normalizeFindingSeverity("MINOR")).toBe("minor");
    expect(normalizeFindingSeverity("note")).toBe("info");
    expect(normalizeFindingSeverity(undefined)).toBe("info");
  });
});

describe("parseSarif", () => {
  it("extracts findings with tool, path, line, snippet and severity", () => {
    const findings = parseSarif(SARIF);
    expect(findings).toHaveLength(2);
    const first = findings[0]!;
    expect(first.tool).toBe("eslint");
    expect(first.ruleId).toBe("no-eval");
    expect(first.path).toBe("src/danger.ts");
    expect(first.line).toBe(12);
    expect(first.snippet).toBe("const x = eval(input)");
    expect(first.severity).toBe("critical");
    // Same rule + file → same dedup key regardless of line.
    expect(findings[0]!.key).toBe(findings[1]!.key);
  });

  it("tolerates malformed/empty input", () => {
    expect(parseSarif("{}")).toEqual([]);
    expect(parseSarif(JSON.stringify({ runs: [{ results: [{}] }] }))).toEqual([]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseSarif("not json")).toThrow(/Invalid JSON/);
  });
});

describe("parseSonar", () => {
  it("strips the project key from component and reads both severity shapes", () => {
    const findings = parseSonar(SONAR);
    expect(findings).toHaveLength(2);
    expect(findings[0]!.path).toBe("src/big.ts");
    expect(findings[0]!.severity).toBe("major");
    expect(findings[0]!.tool).toBe("sonar");
    expect(findings[1]!.path).toBe("src/regex.ts");
    // HIGH impact (MQR mode) is unknown to the scale → falls back to info.
    expect(findings[1]!.severity).toBe("info");
  });
});

describe("parseFindings dispatch", () => {
  it("routes by format", () => {
    expect(parseFindings("sarif", SARIF)).toHaveLength(2);
    expect(parseFindings("sonar", SONAR)).toHaveLength(2);
  });
});

describe("findingToDraft", () => {
  const finding: Finding = {
    tool: "eslint",
    ruleId: "no-eval",
    message: "eval can be harmful.",
    severity: "critical",
    path: "src/danger.ts",
    line: 12,
    snippet: "const x = eval(input)",
    key: "eslint:no-eval:src/danger.ts",
  };

  it("produces a proposed, anchored memory with a stable ingest topic", () => {
    const draft = findingToDraft(finding, { scope: "team" });
    expect(draft.frontmatter.type).toBe("gotcha");
    expect(draft.frontmatter.status).toBe("proposed");
    expect(draft.frontmatter.scope).toBe("team");
    expect(draft.frontmatter.anchor.paths).toEqual(["src/danger.ts"]);
    expect(draft.topic).toBe("ingest:eslint:no-eval:src/danger.ts");
    expect(draft.frontmatter.topic).toBe(draft.topic);
    expect(draft.frontmatter.tags).toContain("ingested");
    expect(draft.body).toContain("eval can be harmful.");
    expect(draft.body).toContain("Offending code:");
  });

  it("honors a convention type override", () => {
    const draft = findingToDraft(finding, { type: "convention" });
    expect(draft.frontmatter.type).toBe("convention");
  });
});

describe("draftsFromFindings", () => {
  it("dedups within a batch, applies minSeverity and limit", () => {
    const findings = parseSarif(SARIF); // two entries, same key
    const drafts = draftsFromFindings(findings);
    expect(drafts).toHaveLength(1); // deduped by key

    const sonar = parseSonar(SONAR);
    expect(draftsFromFindings(sonar, { minSeverity: "major" })).toHaveLength(1); // drops the info one
    expect(draftsFromFindings(sonar, { limit: 1 })).toHaveLength(1);
  });
});

describe("filterNewDrafts", () => {
  it("drops drafts whose topic already exists", () => {
    const drafts = draftsFromFindings(parseSonar(SONAR));
    const existing = [drafts[0]!.topic];
    const fresh = filterNewDrafts(drafts, existing);
    expect(fresh).toHaveLength(drafts.length - 1);
    expect(fresh.some((d) => d.topic === drafts[0]!.topic)).toBe(false);
  });
});

describe("parseEslintJson", () => {
  const ESLINT = JSON.stringify([
    {
      filePath: "/repo/src/a.ts",
      messages: [
        { ruleId: "no-eval", severity: 2, message: "eval is harmful", line: 3 },
        { ruleId: "no-unused-vars", severity: 1, message: "x is unused", line: 9 },
      ],
    },
    { filePath: "/repo/src/clean.ts", messages: [] },
  ]);

  it("parses messages into findings with mapped severities", () => {
    const findings = parseEslintJson(ESLINT);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ tool: "eslint", ruleId: "no-eval", severity: "critical", line: 3 });
    expect(findings[1]!.severity).toBe("major"); // severity 1 (warning) → major
  });

  it("strips the cwd prefix so paths are project-relative", () => {
    const findings = parseEslintJson(ESLINT, { cwd: "/repo" });
    expect(findings[0]!.path).toBe("src/a.ts");
  });

  it("falls back to parse-error rule when ruleId is null", () => {
    const input = JSON.stringify([{ filePath: "/r/x.ts", messages: [{ ruleId: null, severity: 2, message: "syntax" }] }]);
    expect(parseEslintJson(input)[0]!.ruleId).toBe("parse-error");
  });
});

describe("parseNpmAudit", () => {
  const AUDIT = JSON.stringify({
    vulnerabilities: {
      lodash: { name: "lodash", severity: "high", via: [{ title: "Prototype Pollution" }], range: "<4.17.21" },
      minimist: { name: "minimist", severity: "low", via: ["lodash"] },
    },
  });

  it("anchors each vulnerable package to package.json with mapped severity", () => {
    const findings = parseNpmAudit(AUDIT);
    expect(findings).toHaveLength(2);
    const lodash = findings.find((f) => f.ruleId === "lodash")!;
    expect(lodash).toMatchObject({ tool: "npm-audit", path: "package.json", severity: "critical" });
    expect(lodash.message).toContain("Prototype Pollution");
    expect(findings.find((f) => f.ruleId === "minimist")!.severity).toBe("minor");
  });

  it("returns [] for an empty audit", () => {
    expect(parseNpmAudit(JSON.stringify({ vulnerabilities: {} }))).toEqual([]);
  });
});

describe("parseFindings dispatch", () => {
  it("routes eslint and npm-audit formats", () => {
    expect(parseFindings("eslint", JSON.stringify([{ filePath: "a.ts", messages: [{ ruleId: "r", severity: 2, message: "m" }] }]))[0]!.tool).toBe("eslint");
    expect(parseFindings("npm-audit", JSON.stringify({ vulnerabilities: { p: { name: "p", severity: "info", via: [] } } }))[0]!.tool).toBe("npm-audit");
  });
});
