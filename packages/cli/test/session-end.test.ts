import { describe, expect, it } from "vitest";
import { normalizeAnchorPath } from "../src/commands/session-end.js";

describe("normalizeAnchorPath", () => {
  const root = "/home/user/projects/my-app";

  it("returns a relative path unchanged", () => {
    expect(normalizeAnchorPath(root, "src/utils.ts")).toBe("src/utils.ts");
  });

  it("converts an absolute path inside the root to relative", () => {
    expect(normalizeAnchorPath(root, "/home/user/projects/my-app/src/utils.ts")).toBe(
      "src/utils.ts",
    );
  });

  it("converts nested absolute path to relative", () => {
    expect(
      normalizeAnchorPath(root, "/home/user/projects/my-app/packages/cli/src/index.ts"),
    ).toBe("packages/cli/src/index.ts");
  });

  it("keeps absolute paths outside the root unchanged", () => {
    const external = "/home/user/other-repo/src/file.ts";
    expect(normalizeAnchorPath(root, external)).toBe(external);
  });

  it("keeps empty string unchanged", () => {
    expect(normalizeAnchorPath(root, "")).toBe("");
  });

  it("handles root-level file", () => {
    expect(normalizeAnchorPath(root, "/home/user/projects/my-app/package.json")).toBe(
      "package.json",
    );
  });

  it("handles already-relative dotfile paths", () => {
    expect(normalizeAnchorPath(root, ".gitignore")).toBe(".gitignore");
  });

  it("converts absolute dotfile to relative", () => {
    expect(normalizeAnchorPath(root, "/home/user/projects/my-app/.gitignore")).toBe(
      ".gitignore",
    );
  });
});
