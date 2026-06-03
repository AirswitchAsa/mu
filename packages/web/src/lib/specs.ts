import { decodeHandle } from "@mu/protocol";

// =============================================================================
// µ — renderer spec types (client mirror of the server-authoritative contract).
// The server's validateSpec (packages/server/src/core-renderers.ts) is the gate;
// these are the typed shapes the renderer plugins read, plus small accessors with
// sane defaults so a missing/partial spec still renders.
// =============================================================================

export type OverlayKind = "sma" | "ema";
export interface Overlay {
  kind: OverlayKind;
  period: number;
}

export interface PriceChartSpec {
  overlays?: Overlay[];
  volume?: boolean;
}
export interface CompareSpec {
  base?: number;
}
export interface MemoSpec {
  markdown?: string;
}

/** Read overlays defensively from an untyped spec (agent-authored). */
export function overlaysOf(spec: Record<string, unknown> | undefined): Overlay[] {
  const raw = spec?.["overlays"];
  if (!Array.isArray(raw)) return [];
  const out: Overlay[] = [];
  for (const o of raw) {
    if (o && typeof o === "object") {
      const kind = (o as Record<string, unknown>)["kind"];
      const period = (o as Record<string, unknown>)["period"];
      if ((kind === "sma" || kind === "ema") && typeof period === "number" && period > 0) {
        out.push({ kind, period });
      }
    }
  }
  return out;
}

export function showVolume(spec: Record<string, unknown> | undefined): boolean {
  return spec?.["volume"] === true;
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
