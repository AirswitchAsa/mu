import { resolve } from "node:path";
import { createMuServer } from "./server.js";

// Load `.env` (cwd) before reading any keys, so keyed resources (FINNHUB_API_KEY,
// FRED_API_KEY, …) light up at startup. Best-effort: a missing .env is fine.
try {
  process.loadEnvFile?.();
} catch {
  /* no .env — keyed resources stay dormant (isConfigured false) */
}

/**
 * The Docker image's main / `mu-server` entrypoint. Config via env:
 *   PORT (4000) · MU_DATA_ROOT (./.mu-data) · MU_RESOURCES_DIR (./resources) ·
 *   MU_MODEL (e.g. deepseek/deepseek-chat) · MU_TURN_TIMEOUT_MS (180000). Leaving
 *   MU_MODEL unset (or empty) runs API-only — no agent, /message returns NO_DRIVER.
 *   Resource keys (FINNHUB_API_KEY, FRED_API_KEY, …) come from `.env`/env. Run from
 *   the repo root so MU_RESOURCES_DIR resolves to the workspace `resources/`.
 */
const server = await createMuServer({
  dataRoot: process.env["MU_DATA_ROOT"] ?? resolve(process.cwd(), ".mu-data"),
  resourcesDir: process.env["MU_RESOURCES_DIR"] ?? resolve(process.cwd(), "resources"),
  // Unset OR empty → API-only mode (no agent). Only a non-empty value starts opencode.
  model: process.env["MU_MODEL"] || undefined,
  port: Number(process.env["PORT"] ?? 4000),
  turnTimeoutMs: process.env["MU_TURN_TIMEOUT_MS"] ? Number(process.env["MU_TURN_TIMEOUT_MS"]) : undefined,
});

// eslint-disable-next-line no-console
console.log(`µ server listening on ${server.url}`);

const shutdown = (): void => {
  void server.close().then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
