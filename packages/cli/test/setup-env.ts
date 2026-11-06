/**
 * Tests must not inherit the session of the agent or developer running them. Claude Code exports
 * CLAUDE_CODE_SESSION_ID to every shell, and Hivelore now (correctly) resolves the current session
 * from it — so a suite run from inside an agent session would scope markers and baselines to that
 * real session instead of the fixture's "default" one.
 */
for (const name of ["HIVELORE_SESSION_ID", "HAIVE_SESSION_ID", "CLAUDE_SESSION_ID", "CLAUDE_CODE_SESSION_ID"]) {
  delete process.env[name];
}

/**
 * Caches default to the user cache directory (~/.cache/hivelore/<repo>) since 0.67. Fixture repos
 * live in temp dirs; keep their caches inside the fixture so a test run never writes to the
 * developer's home and assertions on `.ai/.cache/...` keep pointing at the fixture.
 */
process.env["HIVELORE_CACHE_DIR"] = ".ai/.cache";
