/**
 * The agent-facing briefing: a versioned, lean projection of {@link BriefingOutput}.
 *
 * The full briefing carried 16 metadata fields per memory (impact_score, impact_tier,
 * semantic_score, read_count, why, match_quality, an absolute file_path…), all at their default
 * value in every sample of field report #12 §1.4, plus an unbudgeted envelope: `budget.spent`
 * counted only project/modules/memory bodies, while the payload ran 2.4× the announced token count
 * (field report #11 §2). Every field here answers "what does the agent do differently because of
 * it?" — anything without an answer stays in the diagnostic payload (`verbose: true`).
 *
 * The budget covers the WHOLE serialized response: {@link fitBriefingToBudget} trims the briefing
 * in a fixed order (symbol map, hints, background bodies, useful bodies, must_read bodies, project
 * context, tail memories) until the projection fits, and `estimated_tokens` is measured on the
 * projection itself.
 */
import { estimateTokens, truncateToTokens } from "@hivelore/core";
import type { BriefingMemory, BriefingOutput } from "./briefing-types.js";

export const AGENT_BRIEFING_SCHEMA = "hivelore.briefing.agent/1";

export interface AgentBriefingMemory {
  id: string;
  type: string;
  priority: BriefingMemory["priority"];
  confidence: BriefingMemory["confidence"];
  /** The memory in one actionable line. */
  rule: string;
  /** Body excerpt (format-dependent). Absent when the rule is all the budget allowed. */
  body?: string;
  /** True when `body` is the complete memory; otherwise `mem_get` returns the rest. */
  complete?: true;
  /** Why it surfaced, in one phrase. */
  matched: string;
  file: string;
  source?: string;
  lifecycle?: BriefingMemory["lifecycle"];
  unreviewed?: true;
}

export interface AgentBriefing {
  schema: typeof AGENT_BRIEFING_SCHEMA;
  task?: string;
  server_version: string;
  action_required: BriefingOutput["action_required"];
  memories: AgentBriefingMemory[];
  last_session?: { as_of?: string; stale?: boolean; body: string };
  project_context?: string;
  module_contexts?: Array<{ name: string; content: string }>;
  symbol_locations?: BriefingOutput["symbol_locations"];
  notices?: string[];
  hints?: string[];
  /** Tokens of THIS payload, envelope included. */
  estimated_tokens: number;
  max_tokens: number;
  trimmed?: string[];
}

function matchedPhrase(memory: BriefingMemory): string {
  if (memory.reasons.includes("anchor")) return memory.priority === "must_read" ? "anchored to a file you passed" : "anchored to the area you are editing";
  if (memory.reasons.includes("symbol")) return "anchored to a requested symbol";
  if (memory.reasons.includes("module") || memory.reasons.includes("domain")) return "same module";
  return "task wording";
}

function relativeFile(filePath: string, root: string): string {
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.startsWith(`${normalizedRoot}/`) ? normalized.slice(normalizedRoot.length + 1) : normalized;
}

/** Pure projection — no I/O. */
export function projectBriefingForAgent(briefing: BriefingOutput, root: string): AgentBriefing {
  const memories: AgentBriefingMemory[] = briefing.memories.map((m) => {
    const rule = (m.rule ?? "").trim();
    const body = m.body?.trim() ?? "";
    // Never ship the rule twice: when the body is just the rule (compact format), drop the body.
    const showBody = body.length > 0 && body !== rule && !m.body_omitted;
    return {
      id: m.id,
      type: m.type,
      priority: m.priority,
      confidence: m.confidence,
      rule: rule || body.split("\n")[0]!.replace(/^#+\s*/, "").slice(0, 200),
      ...(showBody ? { body } : {}),
      ...(showBody && m.delivery === "full" ? { complete: true as const } : {}),
      matched: matchedPhrase(m),
      file: relativeFile(m.file_path, root),
      ...(m.source ? { source: m.source } : {}),
      ...(m.lifecycle && m.lifecycle !== "applied" ? { lifecycle: m.lifecycle } : {}),
      ...(m.unverified || m.status === "proposed" ? { unreviewed: true as const } : {}),
    };
  });

  const notices = [
    ...(briefing.maintenance_notices ?? []).map((n) => n.summary),
    ...briefing.setup_warnings,
  ];

  const project = briefing.project_context;
  const view: AgentBriefing = {
    schema: AGENT_BRIEFING_SCHEMA,
    ...(briefing.task ? { task: briefing.task } : {}),
    server_version: briefing.server_version,
    // Always present, even empty: the human-confirmation protocol keys on this field.
    action_required: briefing.action_required,
    memories,
    ...(briefing.last_session && !briefing.last_session.stale
      ? { last_session: { as_of: briefing.last_session.as_of, body: briefing.last_session.body } }
      : {}),
    ...(project?.content && !project.omitted_recent ? { project_context: project.content } : {}),
    ...(project?.omitted_recent ? { project_context: "(unchanged — sent earlier this session)" } : {}),
    ...(briefing.module_contexts.some((m) => m.content.trim())
      ? { module_contexts: briefing.module_contexts.filter((m) => m.content.trim()).map(({ name, content }) => ({ name, content })) }
      : {}),
    ...(briefing.symbol_locations?.length ? { symbol_locations: briefing.symbol_locations } : {}),
    ...(notices.length ? { notices } : {}),
    ...(briefing.hints?.length ? { hints: briefing.hints } : {}),
    estimated_tokens: 0,
    max_tokens: briefing.budget.max_tokens,
    ...(briefing.budget.trimmed?.length ? { trimmed: briefing.budget.trimmed } : {}),
  };
  view.estimated_tokens = measure(view);
  // One more pass: the number itself is part of the payload.
  view.estimated_tokens = measure(view);
  return view;
}

function measure(view: AgentBriefing): number {
  return estimateTokens(JSON.stringify(view));
}

/**
 * Trim the briefing IN PLACE until its agent projection fits `maxTokens`. Bodies that are dropped
 * flip `delivery` to "partial" so the consultation marker never credits text the agent did not
 * receive. Returns the list of trims applied (also recorded in `budget.trimmed`).
 */
export function fitBriefingToBudget(briefing: BriefingOutput, root: string, maxTokens: number): string[] {
  const trims: string[] = [];
  const size = (): number => projectBriefingForAgent(briefing, root).estimated_tokens;
  // Recorded on the briefing immediately: the `trimmed` list is itself part of the measured payload.
  const record = (what: string): void => {
    if (!trims.includes(what)) trims.push(what);
    briefing.budget.trimmed = [...trims];
  };

  if (size() <= maxTokens) return finish();

  if (briefing.symbol_locations?.length) { briefing.symbol_locations = undefined; record("symbol_locations"); }
  if (size() <= maxTokens) return finish();
  if (briefing.hints?.length) { briefing.hints = undefined; record("hints"); }
  if (size() <= maxTokens) return finish();

  for (const tier of ["background", "useful", "must_read"] as const) {
    // Drop bodies from the lowest-ranked end of the tier first.
    for (const m of [...briefing.memories].reverse()) {
      if (m.priority !== tier || m.body_omitted) continue;
      m.body_omitted = true;
      m.delivery = "partial";
      record(`${tier} bodies`);
      if (size() <= maxTokens) return finish();
    }
  }

  if (briefing.module_contexts.length) {
    briefing.module_contexts = [];
    record("module_contexts");
    if (size() <= maxTokens) return finish();
  }

  const project = briefing.project_context;
  if (project?.content && !project.omitted_recent) {
    const over = size() - maxTokens;
    const keep = Math.max(0, estimateTokens(project.content) - over - 8);
    project.content = keep > 40 ? truncateToTokens(project.content, { maxTokens: keep, mode: "head" }).text : "";
    project.truncated = true;
    record("project_context");
    if (size() <= maxTokens) return finish();
  }

  if (briefing.last_session) { briefing.last_session = undefined; record("last_session"); }
  while (size() > maxTokens && briefing.memories.length > 1) {
    const removed = briefing.memories.pop()!;
    record(`memories after ${briefing.memories.length}`);
    void removed;
  }
  return finish();

  function finish(): string[] {
    if (trims.length) briefing.budget.trimmed = trims;
    return trims;
  }
}
