import type { RendererDef } from "@mu/runtime";
import { INDICATORS, validateIndicators, type ValidationResult } from "@mu/protocol";

const OK: ValidationResult = { ok: true };
const fail = (path: string, message: string): ValidationResult => ({ ok: false, errors: [{ path, message }] });

/**
 * price_chart spec — candlesticks plus catalog indicators. The agent adds/removes
 * an indicator by updating `indicators: [{ name, params? }]`; every name + param
 * is validated against the shared @mu/protocol catalog (the single source of truth
 * the agent discovers via renderer_list). Nothing here is layout or bulk data.
 */
export function validatePriceChartSpec(spec: Record<string, unknown>): ValidationResult {
  const r = validateIndicators(spec["indicators"]);
  return r.ok ? OK : fail(r.path, r.message);
}

/** The catalog the agent reads (via renderer_list) to compose `indicators`. */
const indicatorCatalog = INDICATORS.map((d) => ({
  name: d.name,
  label: d.label,
  placement: d.placement,
  params: d.params.map((p) => ({ name: p.name, default: p.default, min: p.min, max: p.max, ...(p.int ? { int: true } : {}) })),
  ...(d.scale ? { scale: d.scale } : {}),
  ...(d.guides ? { guides: d.guides } : {}),
  description: d.description,
}));

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
 * news spec — a scrolling wire feed. `query` scopes the feed (e.g. a ticker or
 * theme). v0 renders from a baked sample wire client-side; the live `news` shape +
 * resource (real headlines, images) is deferred — see docs/spec/components/renderer.dog.md.
 */
export function validateNewsSpec(spec: Record<string, unknown>): ValidationResult {
  if (spec["query"] !== undefined && typeof spec["query"] !== "string") return fail("query", "must be a string");
  if (spec["limit"] !== undefined && (typeof spec["limit"] !== "number" || !(spec["limit"] > 0))) {
    return fail("limit", "must be a positive number");
  }
  return OK;
}

/**
 * releases spec — a point-in-time release calendar (a vintage timeline: as-of
 * timestamp + reference period, released/revised/scheduled status, actual vs
 * forecast). `scope` filters the calendar (e.g. "macro"). v0 renders from a baked
 * sample calendar; the live point-in-time `releases` shape + resource is deferred.
 */
export function validateReleasesSpec(spec: Record<string, unknown>): ValidationResult {
  if (spec["scope"] !== undefined && typeof spec["scope"] !== "string") return fail("scope", "must be a string");
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
        indicators:
          "Array<{ name: string, params?: Record<string,number> }> — technical indicators from the catalog below. Each name must be one of `indicatorCatalog[].name`; params default to the catalog defaults. 'price' indicators overlay the candle axis; 'pane' indicators draw in their own sub-pane with a y-axis.",
        indicatorCatalog,
      },
      requiresShape: ["ohlcv"],
      title: "Price chart",
      description:
        "OHLCV candlesticks for one instrument. Add technical indicators via spec.indicators, e.g. {indicators:[{name:'ema',params:{period:50}},{name:'volume'},{name:'rsi'}]}. Names + params are validated against the catalog in specSchema.indicatorCatalog (sma/ema/wma/vwap/bollinger/donchian/keltner/psar/ichimoku/supertrend/volume/rsi/macd/stochastic/atr/obv/cci/adx/williamsr/mfi/roc). canvas_update the spec to add/remove an indicator; no refetch needed.",
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
  {
    manifest: {
      type: "news",
      specSchema: {
        query: "string — scopes the wire (a ticker or theme)",
        limit: "positive number — max headlines to surface",
      },
      // v0: renders from a baked sample wire; a real `news` shape + resource is deferred.
      requiresShape: [],
      title: "News wire",
      description:
        "A scrolling news/wire feed of headlines (source, timestamp, tickers, optional image). Scope it with spec.query. v0 shows a sample wire; live headline data is not wired to the broker yet.",
      trust: "core",
    },
    validateSpec: validateNewsSpec,
  },
  {
    manifest: {
      type: "releases",
      specSchema: { scope: "string — filters the calendar (e.g. 'macro', a ticker)" },
      // v0: renders from a baked sample calendar; a real point-in-time `releases` shape is deferred.
      requiresShape: [],
      title: "Release calendar (point-in-time)",
      description:
        "A point-in-time data-release calendar: a vintage timeline of economic/earnings releases with as-of timestamp, reference period, released/revised/scheduled status, and actual vs forecast. Scope with spec.scope. v0 shows a sample calendar; live point-in-time data is not wired to the broker yet.",
      trust: "core",
    },
    validateSpec: validateReleasesSpec,
  },
];
