import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Absolute path to the plugin module opencode should load via `config.plugin`.
 * Built: `dist/plugin.js` sits beside this file; dev (vitest/tsx): `src/plugin.ts`.
 * opencode runs on Bun, which loads either. The driver passes this into the
 * opencode server config so the µ tools register.
 */
export function getPluginPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const built = join(here, "plugin.js");
  return existsSync(built) ? built : join(here, "plugin.ts");
}
