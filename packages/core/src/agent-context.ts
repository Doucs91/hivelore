/**
 * Detect whether the current process runs inside an AI coding-agent harness.
 *
 * WHY: Hivelore's PROCESS gates (briefing-loaded, session-recap, decision-coverage,
 * first-agent bootstrap) encode the agent workflow contract — "AI changes should not
 * enter the codebase without consulting the team's knowledge". A human committing by
 * hand from a terminal is the trusted owner of that knowledge, so those gates can
 * relax to warnings for them (config `enforcement.humanCommits`). DETERMINISTIC gates
 * (block sensors, anti-pattern blocks, artifact hygiene) are about the code itself and
 * must keep binding everyone — this module only informs the process-gate decision.
 *
 * Detection is environment-based and deliberately conservative: agent harnesses run
 * shell commands (and therefore git hooks) with identifying env vars, which propagate
 * into hook processes. Unknown harnesses can opt in by exporting HAIVE_AGENT=1 — the
 * `hivelore run` wrapper does exactly that. HAIVE_AGENT=0 force-overrides to human.
 */

export interface AgentContext {
  /** True when the process appears to run under an AI coding-agent harness. */
  agent: boolean;
  /** Which environment signals matched (empty for a plain human shell). */
  signals: string[];
}

/** Env vars whose PRESENCE (non-empty) identifies a known agent harness. */
const AGENT_ENV_SIGNALS: ReadonlyArray<{ name: string; label: string }> = [
  { name: "HAIVE_SESSION_ID", label: "hivelore-run-wrapper" },
  { name: "CLAUDECODE", label: "claude-code" },
  { name: "CLAUDE_CODE_ENTRYPOINT", label: "claude-code" },
  { name: "CURSOR_AGENT", label: "cursor" },
  { name: "GEMINI_CLI", label: "gemini-cli" },
  { name: "CODEX_SANDBOX", label: "codex" },
  { name: "AIDER_MODEL", label: "aider" },
];

export function detectAgentContext(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): AgentContext {
  // Explicit override wins in both directions (HAIVE_AGENT=1 opt in, =0 force human).
  const explicit = env["HAIVE_AGENT"]?.trim().toLowerCase();
  if (explicit === "1" || explicit === "true") return { agent: true, signals: ["HAIVE_AGENT=1"] };
  if (explicit === "0" || explicit === "false") return { agent: false, signals: ["HAIVE_AGENT=0"] };

  const signals = AGENT_ENV_SIGNALS
    .filter(({ name }) => (env[name] ?? "").trim().length > 0)
    .map(({ name, label }) => `${label} (${name})`);
  return { agent: signals.length > 0, signals: [...new Set(signals)] };
}
