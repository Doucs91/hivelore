/**
 * hAIve GitHub Action — PR memory enrichment script.
 *
 * Reads the .ai/memories/ directory, finds memories relevant to the PR's
 * changed files, and posts/updates a single comment on the PR.
 *
 * Runs entirely from the checked-out repo — no haive CLI needed at runtime.
 */
import * as fs from "fs";
import * as path from "path";
import { getOctokit } from "@actions/github";

// ── Environment ───────────────────────────────────────────────────────────────

const CHANGED_FILES_RAW = process.env["CHANGED_FILES"] ?? "";
const COMMENT_HEADER = process.env["COMMENT_HEADER"] ?? "## 🧠 hAIve — Team Memory Check";
const POST_IF_EMPTY = process.env["POST_IF_EMPTY"] === "true";
const MAX_MEMORIES = parseInt(process.env["MAX_MEMORIES"] ?? "10", 10);
const MEMORIES_DIR_REL = process.env["MEMORIES_DIR"] ?? ".ai/memories";
const GH_TOKEN = process.env["GH_TOKEN"] ?? "";
const GH_REPO = process.env["GH_REPO"] ?? "";
const PR_NUMBER = parseInt(process.env["PR_NUMBER"] ?? "0", 10);
const WORKSPACE = process.env["GITHUB_WORKSPACE"] ?? process.cwd();

const COMMENT_MARKER = "<!-- haive-pr-memory-check -->";

// ── Memory parser (self-contained, no @hiveai/core dep) ──────────────────────

interface Memory {
  id: string;
  title: string;
  type: string;
  scope: string;
  status: string;
  tags: string[];
  anchorPaths: string[];
  requiresHumanApproval: boolean;
  body: string;
  filePath: string;
}

function parseFrontmatter(raw: string): { fm: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw };

  const fmRaw = match[1]!;
  const body = (match[2] ?? "").trim();
  const fm: Record<string, unknown> = {};
  const lines = fmRaw.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const kv = line.match(/^(\w[\w_]*):\s*(.*)/);
    if (!kv) { i++; continue; }

    const key = kv[1]!;
    const val = kv[2]!.trim();

    if (val === "") {
      i++;
      const nested: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("  ")) {
        const nl = lines[i]!.trimStart();
        if (nl.startsWith("- ")) {
          nested.push(nl.slice(2).trim().replace(/^['"]|['"]$/g, ""));
        } else {
          const nkv = nl.match(/^(\w[\w_]*):\s*(.*)/);
          if (nkv) {
            const subKey = nkv[1]!;
            i++;
            const subList: string[] = [];
            while (i < lines.length && lines[i]!.startsWith("    ")) {
              const sl = lines[i]!.trimStart();
              if (sl.startsWith("- ")) subList.push(sl.slice(2).trim().replace(/^['"]|['"]$/g, ""));
              i++;
            }
            if (subList.length) fm[subKey] = subList;
            continue;
          }
        }
        i++;
      }
      if (nested.length) fm[key] = nested;
      continue;
    }

    if (val === "true") fm[key] = true;
    else if (val === "false") fm[key] = false;
    else if (val === "null" || val === "~") fm[key] = null;
    else fm[key] = val.replace(/^['"]|['"]$/g, "");
    i++;
  }

  return { fm, body };
}

function walkDir(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(full, out);
    else if (e.isFile() && e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function loadMemories(memoriesDir: string): Memory[] {
  return walkDir(memoriesDir)
    .map((fp): Memory | null => {
      const raw = fs.readFileSync(fp, "utf8");
      const { fm, body } = parseFrontmatter(raw);
      if (!fm["id"]) return null;
      if (fm["type"] === "session_recap") return null;
      if (fm["status"] === "rejected" || fm["status"] === "deprecated") return null;

      const titleMatch = body.match(/^#{1,3}\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1]! : String(fm["id"]);

      const anchorPaths = (fm["paths"] as string[] | undefined) ?? [];
      const tags = Array.isArray(fm["tags"])
        ? (fm["tags"] as string[])
        : typeof fm["tags"] === "string"
        ? String(fm["tags"]).split(",").map((t) => t.trim()).filter(Boolean)
        : [];

      return {
        id: String(fm["id"]),
        title,
        type: String(fm["type"] ?? "unknown"),
        scope: String(fm["scope"] ?? "team"),
        status: String(fm["status"] ?? "draft"),
        tags,
        anchorPaths,
        requiresHumanApproval: fm["requires_human_approval"] === true,
        body,
        filePath: fp,
      };
    })
    .filter((m): m is Memory => m !== null);
}

function memoriesForFiles(memories: Memory[], changedFiles: string[]): Map<string, Memory[]> {
  const result = new Map<string, Memory[]>();

  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, "/");
    const matching = memories.filter((m) =>
      m.anchorPaths.some((ap) => {
        const a = ap.replace(/\\/g, "/");
        return a === normalized || normalized.endsWith(a) || a.endsWith(normalized);
      }),
    );
    if (matching.length > 0) result.set(file, matching);
  }

  return result;
}

// ── Comment formatter ─────────────────────────────────────────────────────────

const TYPE_ICON: Record<string, string> = {
  gotcha: "⚠️",
  architecture: "🏗️",
  convention: "📐",
  decision: "🎯",
  glossary: "📖",
  attempt: "🔁",
};

function formatComment(
  header: string,
  fileMemories: Map<string, Memory[]>,
  allActionRequired: Memory[],
  changedFiles: string[],
): string {
  const lines: string[] = [COMMENT_MARKER, header, ""];

  const totalMemories = [...fileMemories.values()].reduce((s, a) => s + a.length, 0);
  const uniqueIds = new Set([...fileMemories.values()].flat().map((m) => m.id));

  // ── Action Required banner ───────────────────────────────────────────────
  if (allActionRequired.length > 0) {
    lines.push(
      `> ⚠️ **${allActionRequired.length} memory(ies) require human confirmation** before AI agents can act on them.\n`,
    );

    for (const m of allActionRequired) {
      lines.push(`<details>`);
      lines.push(`<summary>⚠️ <strong>${m.title}</strong> <code>${m.scope}/${m.type}</code></summary>\n`);
      lines.push(m.body.trim());
      lines.push(`\n</details>\n`);
    }
    lines.push("---\n");
  }

  // ── Per-file memories ────────────────────────────────────────────────────
  if (fileMemories.size > 0) {
    lines.push(`**${uniqueIds.size} ${uniqueIds.size === 1 ? "memory" : "memories"} relevant to this PR** (across ${fileMemories.size} file${fileMemories.size > 1 ? "s" : ""}):\n`);

    for (const [file, mems] of fileMemories.entries()) {
      lines.push(`### \`${file}\``);
      for (const m of mems.slice(0, MAX_MEMORIES)) {
        const icon = TYPE_ICON[m.type] ?? "📝";
        const arBadge = m.requiresHumanApproval ? " 🚨 **action required**" : "";
        const scopeBadge = `\`${m.scope}/${m.type}\``;
        const statusBadge = m.status === "stale" ? " *(stale)*" : "";

        lines.push(`<details>`);
        lines.push(
          `<summary>${icon} <strong>${m.title}</strong> ${scopeBadge}${arBadge}${statusBadge}</summary>\n`,
        );

        // Body — strip the "action required" header for non-AR memories (already surfaced above)
        const bodyToShow = m.requiresHumanApproval
          ? m.body.trim()
          : m.body.replace(/^##\s*⚠️ Action requise.*\n[\s\S]*?---\n\n/m, "").trim();

        lines.push(bodyToShow.slice(0, 800) + (bodyToShow.length > 800 ? "\n\n…" : ""));
        lines.push(`\n</details>\n`);
      }
      if (mems.length > MAX_MEMORIES) {
        lines.push(`*+${mems.length - MAX_MEMORIES} more — run \`haive memory for-files ${file}\`*\n`);
      }
    }
  } else {
    lines.push("✅ **No memories found for the changed files.** The code appears well-understood by the team.");
    lines.push("\n> Tip: run `haive memory for-files <file>` locally to check, or `haive briefing` for the full context.\n");
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  lines.push("---");
  lines.push(
    `<sub>🧠 Powered by [hAIve](https://github.com/Doucs91/hAIve) · ${changedFiles.length} file${changedFiles.length > 1 ? "s" : ""} scanned · ${new Date().toUTCString()}</sub>`,
  );

  return lines.join("\n");
}

// ── GitHub comment management ─────────────────────────────────────────────────

async function findExistingComment(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<number | undefined> {
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  const existing = comments.find((c) => c.body?.includes(COMMENT_MARKER));
  return existing?.id;
}

// ── Output helpers ────────────────────────────────────────────────────────────

function setOutput(key: string, value: string): void {
  const outputFile = process.env["GITHUB_OUTPUT"];
  if (outputFile) {
    fs.appendFileSync(outputFile, `${key}=${value}\n`);
  } else {
    console.log(`::set-output name=${key}::${value}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    const changedFiles = CHANGED_FILES_RAW
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);

    console.log(`hAIve: scanning ${changedFiles.length} changed file(s)…`);

    const memoriesDir = path.join(WORKSPACE, MEMORIES_DIR_REL);

    if (!fs.existsSync(memoriesDir)) {
      console.log(`hAIve: memories directory not found at ${memoriesDir}. Skipping.`);
      setOutput("memories_found", "0");
      setOutput("action_required_count", "0");
      setOutput("comment_url", "");
      process.exit(0);
    }

    const allMemories = loadMemories(memoriesDir);
    console.log(`hAIve: loaded ${allMemories.length} memories`);

    const fileMemories = memoriesForFiles(allMemories, changedFiles);
    const allSurfaced = [...fileMemories.values()].flat();
    const uniqueIds = new Set(allSurfaced.map((m) => m.id));
    const actionRequired = allMemories.filter(
      (m) => m.requiresHumanApproval && m.status !== "rejected",
    );

    console.log(
      `hAIve: ${uniqueIds.size} unique memories found across ${fileMemories.size} files ` +
      `(${actionRequired.length} action required)`,
    );

    if (uniqueIds.size === 0 && !POST_IF_EMPTY) {
      console.log("hAIve: no memories found, skipping comment.");
      setOutput("memories_found", "0");
      setOutput("action_required_count", "0");
      setOutput("comment_url", "");
      process.exit(0);
    }

    // ── Post / update comment ──────────────────────────────────────────────
    const body = formatComment(COMMENT_HEADER, fileMemories, actionRequired, changedFiles);

    const [owner, repo] = GH_REPO.split("/") as [string, string];
    const octokit = getOctokit(GH_TOKEN);

    const existingId = await findExistingComment(octokit, owner, repo, PR_NUMBER);

    let commentUrl: string;

    if (existingId) {
      const { data } = await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingId,
        body,
      });
      commentUrl = data.html_url;
      console.log(`hAIve: updated existing comment → ${commentUrl}`);
    } else {
      const { data } = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: PR_NUMBER,
        body,
      });
      commentUrl = data.html_url;
      console.log(`hAIve: posted new comment → ${commentUrl}`);
    }

    setOutput("memories_found", String(uniqueIds.size));
    setOutput("action_required_count", String(actionRequired.length));
    setOutput("comment_url", commentUrl);

    // Fail the check if there are action_required memories (optional — decided by workflow)
    if (actionRequired.length > 0) {
      console.log(
        `::warning::hAIve: ${actionRequired.length} memory(ies) require human confirmation. Review the PR comment.`,
      );
    }

  } catch (err) {
    console.error("hAIve action error:", err);
    process.exit(1);
  }
}

main();
