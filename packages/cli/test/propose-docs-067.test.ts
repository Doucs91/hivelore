import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHaivePaths } from "@hivelore/core";
import { collectCaptureProposals, parseCommitLog } from "../src/commands/memory-propose.js";
import { injectFileContext } from "../src/utils/file-context.js";
import { editKeys } from "../src/utils/pre-edit.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

describe("memory propose — capture from the branch (field reports #8 §6, #9 §7)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "hivelore-propose-"));
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "t@example.com");
    git(root, "config", "user.name", "T");
    await mkdir(path.join(root, ".ai", "memories", "team"), { recursive: true });
    await mkdir(path.join(root, "deploy"), { recursive: true });
    await writeFile(path.join(root, "deploy", "renew.sh"), "nginx -s reload\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "chore: init");
    git(root, "checkout", "-qb", "fix/reload");
    await writeFile(path.join(root, "deploy", "renew.sh"), "kill -HUP \"$(cat /run/nginx.pid)\"\n");
    git(root, "commit", "-qam", "fix: reload nginx after cert renewal", "-m",
      "The reload was silently ignored because the pid file moved to /run/nginx.pid in the new image.");
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("proposes a gotcha from a fix commit that explains its cause, anchored to the changed file", async () => {
    const { base, proposals } = await collectCaptureProposals(root);
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ kind: "fix-lesson", paths: ["deploy/renew.sh"] });
    expect(proposals[0]!.commands[0]).toContain("--rule");
  });

  it("parses git log records with bodies and file lists", () => {
    const raw = "\x1eabc\x1ffix: a\x1fbecause b\x1f\n\nsrc/a.ts\nsrc/b.ts\n\x1edef\x1fchore\x1f\x1f\n\nREADME.md\n";
    expect(parseCommitLog(raw)).toEqual([
      { sha: "abc", subject: "fix: a", body: "because b", files: ["src/a.ts", "src/b.ts"] },
      { sha: "def", subject: "chore", body: "", files: ["README.md"] },
    ]);
  });
});

describe("edit-time doc warnings (field report #9 §1)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "hivelore-docs-"));
    await mkdir(path.join(root, ".ai", "memories", "team"), { recursive: true });
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(path.join(root, "docs", "security.md"),
      "# Security\n\nEnforcing `worker-src 'self'` would break the PDF viewer: pdf.js starts its worker from a blob URL.\n");
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("warns when the edit touches a key a doc warns about, once per session", async () => {
    const paths = resolveHaivePaths(root);
    const keys = editKeys({ tool_name: "Edit", tool_input: { file_path: "config/csp.ts", old_string: "script-src 'self'", new_string: "script-src 'self'; worker-src 'self'" } });
    expect(keys).toContain("worker-src");
    const first = await injectFileContext(paths, ["config/csp.ts"], "s-docs", { editKeys: keys });
    expect(first).toContain("docs/security.md:3");
    expect(first).toContain("would break the PDF viewer");
    expect(await injectFileContext(paths, ["config/csp.ts"], "s-docs", { editKeys: keys })).toBeNull();
  });

  it("stays silent when docs only describe, never warn", async () => {
    await writeFile(path.join(root, "docs", "security.md"), "# Security\n\nThe `worker-src` directive is set in config/csp.ts.\n");
    const paths = resolveHaivePaths(root);
    expect(await injectFileContext(paths, ["config/csp.ts"], "s-quiet", { editKeys: ["worker-src"] })).toBeNull();
  });
});
