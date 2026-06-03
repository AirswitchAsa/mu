import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Resource } from "./resource.js";
import type { ResourceRegistry } from "./registry.js";

interface PkgJson {
  name?: string;
  main?: string;
  exports?: Record<string, unknown> | string;
  mu?: { kind?: string };
}

/** A discovered resource plugin: its package dir, name, and resolved entry file. */
export interface DiscoveredResource {
  readonly dir: string;
  readonly name: string;
  readonly entry: string;
}

function resolveEntry(dir: string, pkg: PkgJson): string | null {
  const candidates: string[] = [];
  const dot = typeof pkg.exports === "object" ? (pkg.exports as Record<string, unknown>)["."] : undefined;
  if (dot && typeof dot === "object") {
    const imp = (dot as Record<string, unknown>)["import"];
    if (typeof imp === "string") candidates.push(imp);
  }
  if (typeof pkg.main === "string") candidates.push(pkg.main);
  candidates.push("dist/index.js", "src/index.ts");
  for (const rel of candidates) {
    const full = join(dir, rel);
    if (existsSync(full)) return full;
  }
  return null;
}

/**
 * Discover resource plugins under a directory: every immediate subdir whose
 * package.json declares `mu.kind === "resource"`. This is the same glob-folder →
 * read-manifest pattern renderers will reuse (the dogfooded plugin host).
 */
export async function discoverResources(resourcesDir: string): Promise<DiscoveredResource[]> {
  if (!existsSync(resourcesDir)) return [];
  const entries = await readdir(resourcesDir, { withFileTypes: true });
  const found: DiscoveredResource[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = join(resourcesDir, e.name);
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as PkgJson;
    if (pkg.mu?.kind !== "resource") continue;
    const entry = resolveEntry(dir, pkg);
    if (!entry) continue;
    found.push({ dir, name: pkg.name ?? e.name, entry });
  }
  return found;
}

/**
 * Load and register every discovered resource. Each module must export the
 * `Resource` as `default` or as a named `resource`. Returns the registered ids.
 * Loaded at `#MuServer` startup; no hot-reload (refresh = restart).
 */
export async function loadResources(
  resourcesDir: string,
  registry: ResourceRegistry,
): Promise<string[]> {
  const discovered = await discoverResources(resourcesDir);
  const ids: string[] = [];
  for (const d of discovered) {
    const mod = (await import(pathToFileURL(d.entry).href)) as {
      default?: Resource;
      resource?: Resource;
    };
    const resource = mod.default ?? mod.resource;
    if (!resource || !resource.manifest) {
      throw new Error(`resource '${d.name}' (${d.entry}) has no default/resource export`);
    }
    registry.register(resource);
    ids.push(resource.manifest.id);
  }
  return ids;
}
