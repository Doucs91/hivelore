import { describe, expect, it } from "vitest";
import type { LoadedMemory } from "../src/loader.js";
import { rankMemoriesLexical } from "../src/lexical-rank.js";

function mk(body: string, id: string): LoadedMemory {
  return {
    filePath: `/m/${id}.md`,
    memory: {
      frontmatter: {
        id,
        scope: "team",
        type: "convention",
        status: "validated",
        anchor: { paths: [], symbols: [] },
        tags: ["alpha"],
        created_at: "2026-01-01T00:00:00.000Z",
        expires_when: null,
        verified_at: null,
        stale_reason: null,
        related_ids: [],
        last_read_at: null,
        requires_human_approval: false,
        revision_count: 0,
      },
      body: `# Hi\n${body}`,
    },
  };
}

describe("rankMemoriesLexical", () => {
  it("ranks BM25-ish by query tokens", () => {
    const a = mk("rabbit hops in the meadow", "a");
    const b = mk("rabbit stew recipe details", "b");
    const { ranked } = rankMemoriesLexical([a, b], "rabbit meadow", 5);
    expect(ranked[0]?.memory.frontmatter.id).toBe("a");
  });
});
