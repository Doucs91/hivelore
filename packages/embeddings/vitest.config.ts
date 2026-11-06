import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    setupFiles: ["./test/setup-env.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
