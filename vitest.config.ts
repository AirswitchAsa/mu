import { defineConfig } from "vitest/config";

// The live tiers drive SHARED, rate-limited externals (DeepSeek, Yahoo) and each spawn an
// opencode server; running their files in parallel makes them contend and flake. When a
// live flag is set, run test files sequentially. Keyless deterministic runs stay parallel
// (fast) — they touch nothing shared.
const LIVE = Boolean(process.env["MU_LIVE_OPENCODE"] || process.env["MU_LIVE_DATA"]);

export default defineConfig({
  test: {
    // Network/model-gated suites (live Yahoo fetch, live DeepSeek round-trip) opt in
    // via env so keyless CI stays green on the deterministic tiers.
    include: ["packages/**/*.test.ts", "resources/**/*.test.ts"],
    // DuckDB + opencode-server fixtures need real time; keep generous ceilings.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    ...(LIVE ? { fileParallelism: false } : {}),
  },
});
