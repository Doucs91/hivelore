/**
 * Caches default to the user cache directory (~/.cache/hivelore/<repo>) since 0.67. Fixture repos
 * live in temp dirs; keep their caches inside the fixture so a test run never writes to the
 * developer's home.
 */
process.env["HIVELORE_CACHE_DIR"] = ".ai/.cache";
