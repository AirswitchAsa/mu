import { resolve } from "node:path";
import { createMuServer } from "./server.js";

// Load `.env` (cwd) before reading any keys, so the agent key + keyed resources
// (DEEPSEEK_API_KEY, FINNHUB_API_KEY, FRED_API_KEY, …) light up at startup. Best-effort:
// a missing .env is fine.
try {
  process.loadEnvFile?.();
} catch {
  /* no .env — agent runs API-only, keyed resources stay dormant (isConfigured false) */
}

/**
 * The Docker image's main / `mu-server` entrypoint. Config via env:
 *   PORT (4000) · MU_DATA_ROOT (./.mu-data) · MU_RESOURCES_DIR (./resources) ·
 *   MU_MODEL (e.g. deepseek/deepseek-chat) · MU_TURN_TIMEOUT_MS (180000). Leaving the
 *   model unset everywhere runs API-only — no agent, /message returns NO_DRIVER.
 *   Resource keys (FINNHUB_API_KEY, FRED_API_KEY, …) come from `.env`/env. Run from
 *   the repo root so MU_RESOURCES_DIR resolves to the workspace `resources/`.
 *
 *   THE AGENT (opencode) needs just two values: MU_MODEL (provider/model) and that
 *   provider's key env var, by convention <PROVIDER>_API_KEY (deepseek → DEEPSEEK_API_KEY).
 *   If MU_MODEL is set but its key is empty, µ fails fast at boot. `opencode auth login`'s
 *   auth.json does NOT apply — µ relocates opencode's home (see below), so the key must be
 *   in the env.
 *
 *   All µ state lives under MU_DATA_ROOT: the broker store, the session sidecars
 *   (`_sessions/`), AND opencode's own session storage (`opencode/`, so the agent's
 *   sessions survive a restart and resume). One canonical volume mounted at
 *   MU_DATA_ROOT persists everything. To split opencode's storage onto its own volume,
 *   point MU_OPENCODE_DATA_HOME at it.
 */
const server = await createMuServer({
  dataRoot: process.env["MU_DATA_ROOT"] ?? resolve(process.cwd(), ".mu-data"),
  resourcesDir: process.env["MU_RESOURCES_DIR"] ?? resolve(process.cwd(), "resources"),
  // Unset/empty → API-only mode (no agent).
  model: process.env["MU_MODEL"] || undefined,
  port: Number(process.env["PORT"] ?? 4000),
  // Bind address. In the container set HOST=0.0.0.0 so the port is reachable from outside;
  // the opencode callback url stays loopback regardless (the plugin runs in this process
  // tree). Defaults to loopback for local/dev runs.
  hostname: process.env["HOST"] || undefined,
  // When set, the server also serves the built web client at `/` (single-image deploy).
  // Unset in dev — Vite serves the web on :5173 against this API.
  webDir: process.env["MU_WEB_DIR"] || undefined,
  turnTimeoutMs: process.env["MU_TURN_TIMEOUT_MS"] ? Number(process.env["MU_TURN_TIMEOUT_MS"]) : undefined,
  // Defaults to dataRoot (opencode storage co-located under MU_DATA_ROOT); override only
  // to put opencode's storage on a separate canonical volume.
  opencodeDataHome: process.env["MU_OPENCODE_DATA_HOME"] || undefined,
});

// eslint-disable-next-line no-console
console.log(`µ server listening on ${server.url}`);

const shutdown = (): void => {
  void server.close().then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
