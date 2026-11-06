/**
 * Tests must not inherit the session of the agent or developer running them. Claude Code exports
 * CLAUDE_CODE_SESSION_ID to every shell, and Hivelore now (correctly) resolves the current session
 * from it — so a suite run from inside an agent session would scope markers and baselines to that
 * real session instead of the fixture's "default" one.
 */
for (const name of ["HIVELORE_SESSION_ID", "HAIVE_SESSION_ID", "CLAUDE_SESSION_ID", "CLAUDE_CODE_SESSION_ID"]) {
  delete process.env[name];
}
