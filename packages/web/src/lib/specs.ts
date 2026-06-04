import { decodeHandle, INDICATOR_BY_NAME, resolveIndicatorParams, type IndicatorDef } from "@mu/protocol";

// =============================================================================
// µ — renderer spec types (client mirror of the server-authoritative contract).
// The server's validateSpec (packages/server/src/core-renderers.ts) is the gate;
// these are the typed shapes the renderer plugins read, plus small accessors with
// sane defaults so a missing/partial spec still renders.
// =============================================================================

export interface PriceChartSpec {
  indicators?: { name: string; params?: Record<string, number> }[];
}
export interface CompareSpec {
  base?: number;
}
export interface MemoSpec {
  markdown?: string;
}

/** A price_chart indicator resolved against the catalog, ready to draw. */
export interface ActiveIndicator {
  readonly name: string;
  readonly def: IndicatorDef;
  readonly params: Record<string, number>;
  /** stable identity for reconcile (name + ordered param values). */
  readonly key: string;
  /** "SMA 50", "BB 20/2", "MACD 12/26/9" — for the legend. */
  readonly label: string;
}

/**
 * Read the `indicators` list defensively from an untyped (agent-authored) spec,
 * resolving each against the catalog and filling default params. Unknown names
 * are dropped — the catalog is the gate, so the renderer never sees garbage.
 */
export function indicatorsOf(spec: Record<string, unknown> | undefined): ActiveIndicator[] {
  const raw = spec?.["indicators"];
  if (!Array.isArray(raw)) return [];
  const out: ActiveIndicator[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const name = (it as Record<string, unknown>)["name"];
    if (typeof name !== "string") continue;
    const def = INDICATOR_BY_NAME.get(name);
    if (!def) continue;
    const rawParams = (it as Record<string, unknown>)["params"];
    const params = resolveIndicatorParams(def, rawParams && typeof rawParams === "object" ? (rawParams as Record<string, number>) : undefined);
    const values = def.params.map((p) => params[p.name]);
    const key = `${name}:${values.join(":")}`;
    const label = values.length ? `${def.label} ${values.join("/")}` : def.label;
    out.push({ name, def, params, key, label });
  }
  return out;
}

export function compareBase(spec: Record<string, unknown> | undefined): number {
  const base = spec?.["base"];
  return typeof base === "number" && base > 0 ? base : 100;
}

export function memoMarkdown(spec: Record<string, unknown> | undefined): string {
  const md = spec?.["markdown"];
  return typeof md === "string" ? md : "";
}

/**
 * The instrument symbol for a binding, resilient to a malformed handle. The agent
 * authors bindings, so a legend must never throw on a surprise string — fall back
 * to the raw handle rather than blanking the window.
 */
export function symbolOf(handle: string): string {
  try {
    return decodeHandle(handle).entity || handle;
  } catch {
    return handle || "—";
  }
}
