import { describe, expect, it } from "vitest";
import { buildFrontmatter, serializeMemory } from "@hivelore/core";

// The module runs `main()` on import unless this is set (see the bottom of run.ts).
process.env["HIVELORE_ACTION_TEST"] = "1";
const { parseFrontmatter, extractSensor } = await import("../src/run.js");

/**
 * The CLI writes memories, the action reads them. They used to disagree: the CLI folded any scalar
 * past 80 columns into a `>-` block and the action's line parser took `>-` as the anchor path —
 * every PR touching a memory with a long anchor got "anchor paths missing" for a file that existed
 * (field report #10 §1). This round-trip pins the writer and the reader together.
 */
describe("CLI writer ↔ action reader round-trip", () => {
  const longPath =
    "backend/src/main/resources/db/migration/some/rather/long/directory/structure/V23__with_a_long_file_name.sql";
  const quoted = "docs/runbooks/rotate: owner's password #1.md";

  it("keeps long and special-character anchor paths identical", () => {
    const fm = buildFrontmatter({
      type: "gotcha",
      slug: "long-anchor",
      scope: "team",
      status: "validated",
      paths: ["short/path.ts", longPath, quoted],
      tags: ["db", "migration"],
      sensor: {
        kind: "regex",
        pattern: "LocalDate\\.now\\(\\)",
        message:
          "LocalDate.now() without a zone reads the server's default time zone, which differs between CI and production — pass the business ZoneId explicitly.",
        severity: "block",
      } as never,
    });
    const raw = serializeMemory({ frontmatter: fm, body: "# Long anchor\n\nBody." });

    expect(raw, "the writer must never fold a scalar").not.toMatch(/^\s*-?\s*[>|][-+]?\s*$/m);

    const { fm: read, body } = parseFrontmatter(raw);
    const anchor = read["anchor"] as { paths: string[] };
    expect(anchor.paths).toEqual(["short/path.ts", longPath, quoted]);
    expect(read["tags"]).toEqual(["db", "migration"]);
    expect(body).toBe("# Long anchor\n\nBody.");
    expect(extractSensor(raw)).toEqual({ severity: "block", message: fm.sensor!.message });
  });

  it("still reads a memory folded by an older CLI", () => {
    const legacy = [
      "---",
      "id: 2026-01-01-gotcha-folded",
      "scope: team",
      "type: gotcha",
      "status: validated",
      "anchor:",
      "  paths:",
      "    - short/path.ts",
      "    - >-",
      `      ${longPath}`,
      "---",
      "# Folded",
    ].join("\n");
    const anchor = parseFrontmatter(legacy).fm["anchor"] as { paths: string[] };
    expect(anchor.paths).toEqual(["short/path.ts", longPath]);
  });
});
