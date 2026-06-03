import type { RendererDef } from "@mu/runtime";
import type { ValidationResult } from "@mu/protocol";

const OK: ValidationResult = { ok: true };
const fail = (path: string, message: string): ValidationResult => ({ ok: false, errors: [{ path, message }] });

/**
 * price_chart spec — candlesticks plus baked, toggleable indicators. The agent
 * adds/removes an indicator by updating `overlays`; `volume` toggles the volume
 * pane. Nothing here is layout, and nothing carries bulk data.
 */
export function validatePriceChartSpec(spec: Record<string, unknown>): ValidationResult {
  const overlays = spec["overlays"];
  if (overlays !== undefined) {
    if (!Array.isArray(overlays)) return fail("overlays", "must be an array");
    for (let i = 0; i < overlays.length; i++) {
      const o = overlays[i] as Record<string, unknown> | null;
      if (typeof o !== "object" || o === null) return fail(`overlays[${i}]`, "must be an object");
      if (o["kind"] !== "sma" && o["kind"] !== "ema") return fail(`overlays[${i}].kind`, "must be 'sma' or 'ema'");
      const period = o["period"];
      if (typeof period !== "number" || !Number.isInteger(period) || period <= 0) {
        return fail(`overlays[${i}].period`, "must be a positive integer");
      }
    }
  }
  if (spec["volume"] !== undefined && typeof spec["volume"] !== "boolean") return fail("volume", "must be a boolean");
  return OK;
}

/** compare spec — index-normalized multi-line; `base` is the common index base. */
export function validateCompareSpec(spec: Record<string, unknown>): ValidationResult {
  const base = spec["base"];
  if (base !== undefined && (typeof base !== "number" || !(base > 0))) return fail("base", "must be a positive number");
  return OK;
}

/** memo spec — agent-authored markdown; nothing data-bound. */
export function validateMemoSpec(spec: Record<string, unknown>): ValidationResult {
  if (spec["markdown"] !== undefined && typeof spec["markdown"] !== "string") return fail("markdown", "must be a string");
  return OK;
}

/**
 * Core renderer manifests the server advertises to the agent (v0, trusted in-core).
 * The frontend owns the actual renderer *code* (the playground components, loaded
 * client-side like resources); these manifests are the server-authoritative
 * contract the runtime validates agent specs against and the agent discovers via
 * `renderer_list`. A renderer binds to a **shape, never a provider**. `specSchema`
 * is an informal field map the agent can read; `validateSpec` is the real gate.
 */
export const coreRenderers: RendererDef[] = [
  {
    manifest: {
      type: "price_chart",
      specSchema: {
        overlays: "Array<{ kind: 'sma' | 'ema', period: positive integer }> — moving-average overlays",
        volume: "boolean — show the volume pane",
      },
      requiresShape: ["ohlcv"],
      title: "Price chart",
      description:
        "OHLCV candlesticks for one instrument. Toggle baked indicators via spec — overlays (e.g. [{kind:'sma',period:50}]) and volume. canvas_update the spec to add/remove an overlay; no refetch needed.",
      trust: "core",
    },
    validateSpec: validatePriceChartSpec,
  },
  {
    manifest: {
      type: "compare",
      specSchema: { base: "positive number — index base for normalization (default 100)" },
      requiresShape: ["ohlcv"],
      title: "Comparison",
      description:
        "Index-normalized comparison of two or more instruments: each bound ohlcv handle is rebased to a common value (default 100) so shapes line up regardless of price. Bind multiple handles via canvas_create handle[] or canvas_bind.",
      trust: "core",
    },
    validateSpec: validateCompareSpec,
  },
  {
    manifest: {
      type: "memo",
      specSchema: { markdown: "string — the note body" },
      requiresShape: [],
      title: "Memo",
      description: "Markdown analysis written by the agent. No data binding. spec: { markdown: string }.",
      trust: "core",
    },
    validateSpec: validateMemoSpec,
  },
];
