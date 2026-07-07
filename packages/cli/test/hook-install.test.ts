import { describe, expect, it } from "vitest";
import { stripHiveloreHookBlock, buildHookFileContent, hookIsStale } from "../src/commands/enforce.js";

// The current-format block the installer writes for pre-commit.
const OWN_BODY = `#!/bin/sh
# Hivelore enforcement hook
_hivelore() {
  if command -v hivelore >/dev/null 2>&1; then hivelore "$@"
  else return 0
  fi
}
_hivelore enforce check --stage pre-commit --dir . || exit $?
`;

// A repo installed BEFORE the v0.51.0 rename: the hook calls the removed \`haive\` binary directly.
const LEGACY_HOOK = `#!/bin/sh
# hAIve enforcement hook
haive enforce check --stage pre-commit --dir . || exit $?
`;

// The exact broken artifact the old installer produced: legacy block + appended new block.
const DUPLICATE_HOOK = `${LEGACY_HOOK}\n${OWN_BODY}`;

// A genuine third-party hook (husky) with no Hivelore content.
const FOREIGN_HOOK = `#!/bin/sh
. "$(dirname "$0")/_/husky.sh"
npm test
`;

describe("hookIsStale — detect the commit-breaking states", () => {
  it("flags a legacy hook that calls the removed haive binary", () => {
    expect(hookIsStale(LEGACY_HOOK)).toBe(true);
  });
  it("flags the duplicate artifact (two blocks / two shebangs)", () => {
    expect(hookIsStale(DUPLICATE_HOOK)).toBe(true);
  });
  it("does NOT flag a healthy current hook or a foreign one", () => {
    expect(hookIsStale(OWN_BODY)).toBe(false);
    expect(hookIsStale(FOREIGN_HOOK)).toBe(false);
    expect(hookIsStale("")).toBe(false);
  });
});

describe("stripHiveloreHookBlock", () => {
  it("removes a current-format Hivelore block wholesale (leaves nothing foreign)", () => {
    expect(stripHiveloreHookBlock(OWN_BODY)).toBe("");
  });

  it("removes a LEGACY hAIve block (the rename regression) — including the dead haive call", () => {
    const stripped = stripHiveloreHookBlock(LEGACY_HOOK);
    expect(stripped).toBe("");
    expect(stripped).not.toContain("haive");
  });

  it("removes BOTH blocks from the duplicate artifact (no stale haive line survives)", () => {
    const stripped = stripHiveloreHookBlock(DUPLICATE_HOOK);
    expect(stripped).toBe("");
    expect(stripped).not.toContain("haive");
  });

  it("preserves a foreign hook untouched", () => {
    const stripped = stripHiveloreHookBlock(FOREIGN_HOOK);
    expect(stripped).toContain("husky.sh");
    expect(stripped).toContain("npm test");
  });

  it("keeps foreign content while removing an appended Hivelore block", () => {
    const stripped = stripHiveloreHookBlock(`${FOREIGN_HOOK}\n${OWN_BODY}`);
    expect(stripped).toContain("npm test");
    expect(stripped).not.toContain("_hivelore");
    expect(stripped).not.toContain("enforce check");
  });
});

describe("buildHookFileContent — idempotent regeneration", () => {
  it("returns our block wholesale for a fresh (empty) hook", () => {
    expect(buildHookFileContent("", OWN_BODY)).toBe(OWN_BODY);
  });

  it("REPLACES a legacy hAIve hook (fixes the append-duplicate bug)", () => {
    const out = buildHookFileContent(LEGACY_HOOK, OWN_BODY);
    expect(out).toBe(OWN_BODY);
    expect(out).not.toContain("haive"); // the dead binary call is gone
    expect((out.match(/enforce check/g) ?? []).length).toBe(1); // exactly one invocation
  });

  it("collapses the duplicate artifact back to a single clean block", () => {
    const out = buildHookFileContent(DUPLICATE_HOOK, OWN_BODY);
    expect(out).toBe(OWN_BODY);
    expect((out.match(/#!/g) ?? []).length).toBe(1); // no stray mid-script shebang
  });

  it("preserves a foreign husky hook and appends our block after it", () => {
    const out = buildHookFileContent(FOREIGN_HOOK, OWN_BODY);
    expect(out).toContain("husky.sh");
    expect(out).toContain("npm test");
    expect(out).toContain("_hivelore enforce check");
    expect((out.match(/#!/g) ?? []).length).toBe(1); // single shebang at the top
    expect(out.startsWith("#!/bin/sh")).toBe(true);
  });

  it("is a fixed point: regenerating over its own output does not grow or duplicate", () => {
    const once = buildHookFileContent(FOREIGN_HOOK, OWN_BODY);
    const twice = buildHookFileContent(once, OWN_BODY);
    expect(twice).toBe(once);
    // And the pure Hivelore case is stable too.
    expect(buildHookFileContent(buildHookFileContent(LEGACY_HOOK, OWN_BODY), OWN_BODY)).toBe(OWN_BODY);
  });
});
