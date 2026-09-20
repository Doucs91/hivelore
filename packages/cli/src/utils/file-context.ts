import path from "node:path";
import {
  loadMemoriesFromDir, memoryMatchesAnchorPaths, isRetiredMemory, verifyAnchor,
  readSessionBriefingMarker, writeBriefingMarker, trackReads, supersededMemoryIds,
  normalizeSessionId, extractActionsBriefBody, type HaivePaths,
} from "@hivelore/core";
import { sessionIdentity } from "./task-session.js";

/** Quiet unless new, applicable context exists. Only displayed IDs count as consulted. */
export async function injectFileContext(paths: HaivePaths, files: string[], sessionId?: string): Promise<string | null> {
  const relative = files.map(file => path.relative(paths.root, path.resolve(paths.root, file)).replace(/\\/g, "/"))
    .filter(file => file && file !== ".." && !file.startsWith("../") && !file.startsWith(".ai/"));
  if (!relative.length) return null;
  const id = normalizeSessionId(sessionIdentity(sessionId));
  const marker = await readSessionBriefingMarker(paths, id);
  const consulted = new Set(marker?.memory_ids ?? []);
  const all = await loadMemoriesFromDir(paths.memoriesDir);
  const verified = [];
  for (const item of all) {
    if (!item.memory.frontmatter.checks?.length || !(await verifyAnchor(item.memory, { projectRoot: paths.root })).stale) verified.push(item);
  }
  const superseded = supersededMemoryIds(verified);
  const candidates = verified.filter(({ memory: m }) => m.frontmatter.status === "validated" &&
    !isRetiredMemory(m.frontmatter, m.body) && !consulted.has(m.frontmatter.id) &&
    !superseded.has(m.frontmatter.id) && memoryMatchesAnchorPaths(m, relative))
    .sort((a, b) => Number(b.memory.frontmatter.requires_human_approval) - Number(a.memory.frontmatter.requires_human_approval) ||
      Number(b.memory.frontmatter.sensor?.severity === "block") - Number(a.memory.frontmatter.sensor?.severity === "block"));
  const displayed = [];
  for (const candidate of candidates) {
    if ((await verifyAnchor(candidate.memory, { projectRoot: paths.root })).stale) continue;
    displayed.push(candidate);
    if (displayed.length === 3) break;
  }
  if (!displayed.length) return null;
  const text = ["Hivelore — relevant team policy for this edit", ...displayed.map(({ memory: m }) =>
    `${m.frontmatter.id}${m.frontmatter.requires_human_approval ? " — HUMAN CONFIRMATION REQUIRED" : ""}\n` +
    `Applies to: ${relative.filter(f => memoryMatchesAnchorPaths(m, [f])).slice(0, 3).join(", ")}\n` +
    extractActionsBriefBody(m.body).trim().slice(0, 400))].join("\n\n");
  const ids = displayed.map(m => m.memory.frontmatter.id);
  await writeBriefingMarker(paths, { sessionId: id, task: marker?.task ?? "file context",
    source: "haive-pre-edit", files: relative, memoryIds: [...consulted, ...ids] });
  await trackReads(paths, ids);
  return text;
}
