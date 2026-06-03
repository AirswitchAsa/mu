import type { RendererPlugin } from "./types";

// =============================================================================
// µ — client renderer registry. Loaded like resources: glob the renderers folder,
// read each plugin's `type`, register it. Drop a new folder under renderers/ and
// it self-registers on next build — no central edit. The server manifest decides
// which types are *valid*; this map provides the *draw code* for each.
// =============================================================================

const modules = import.meta.glob<{ default?: RendererPlugin; plugin?: RendererPlugin }>(
  "./*/index.ts",
  { eager: true },
);

const registry = new Map<string, RendererPlugin>();
for (const path in modules) {
  const mod = modules[path]!;
  const plugin = mod.default ?? mod.plugin;
  if (plugin?.type) registry.set(plugin.type, plugin);
}

export function getRenderer(type: string): RendererPlugin | undefined {
  return registry.get(type);
}
