import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Network/model-gated suites (live Yahoo fetch, live DeepSeek round-trip) opt in
    // via env so keyless CI stays green on the deterministic tiers.
    include: ["packages/**/*.test.ts", "resources/**/*.test.ts"],
    // DuckDB + opencode-server fixtures need real time; keep generous ceilings.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
