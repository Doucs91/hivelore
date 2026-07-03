import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFrontmatter, loadMemoriesFromDirDetailed, serializeMemory } from "../src/index.js";

/**
 * A memory file with corrupt frontmatter must not vanish silently — the detailed
 * loader reports it so doctor can surface a lost team lesson.
 */
describe("loadMemoriesFromDirDetailed", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "haive-loader-"));
    await mkdir(path.join(dir, "team"), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads valid files and reports invalid ones with the parse error", async () => {
    const fm = buildFrontmatter({ type: "gotcha", slug: "ok", scope: "team", status: "validated", tags: [] });
    await writeFile(
      path.join(dir, "team", `${fm.id}.md`),
      serializeMemory({ frontmatter: fm, body: "# Ok\n\nfine" }),
      "utf8",
    );
    await writeFile(path.join(dir, "team", "broken.md"), "---\nid: broken\nthis is: [not valid\n", "utf8");

    const { loaded, invalid } = await loadMemoriesFromDirDetailed(dir);
    expect(loaded).toHaveLength(1);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.filePath).toContain("broken.md");
    expect(invalid[0]!.error.length).toBeGreaterThan(0);
  });

  it("reports nothing invalid on a clean corpus", async () => {
    const { loaded, invalid } = await loadMemoriesFromDirDetailed(dir);
    expect(loaded).toEqual([]);
    expect(invalid).toEqual([]);
  });
});
