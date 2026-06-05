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
 * news spec — a scrolling wire feed over bound `news` handles. Optional `query`
 * scopes/labels the wire; `limit` caps headlines. The card interleaves all bound
 * handles by time and labels each item's source.
 */
export function validateNewsSpec(spec: Record<string, unknown>): ValidationResult {
  if (spec["query"] !== undefined && typeof spec["query"] !== "string") return fail("query", "must be a string");
  if (spec["limit"] !== undefined && (typeof spec["limit"] !== "number" || !(spec["limit"] > 0))) {
    return fail("limit", "must be a positive number");
  }
  return OK;
}

/**
 * releases spec — a point-in-time release calendar over bound `releases` handles
 * (a vintage timeline: reference period, scheduled/released/revised status, actual
 * vs forecast). Optional `scope` labels the calendar.
 */
export function validateReleasesSpec(spec: Record<string, unknown>): ValidationResult {
  if (spec["scope"] !== undefined && typeof spec["scope"] !== "string") return fail("scope", "must be a string");
  return OK;
}

/**
 * key_stats spec — a company key-statistics panel over a bound `key_stats` handle
 * (cross-section): a snapshot of valuation / trading / profile fields. Optional
 * `scope` labels the panel.
 */
export function validateKeyStatsSpec(spec: Record<string, unknown>): ValidationResult {
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
        query: "string — optional label/scope for the wire",
        limit: "positive number — max headlines to surface",
      },
      requiresShape: ["news"],
      title: "News wire",
      description:
        "A scrolling wire of headlines (source · time · tickers) over one or more bound `news` handles. Fetch a feed with data_fetch {shape:'news', entity:<ticker>} (sources: yahoo per-ticker, finnhub per-ticker; cnbc general — entity is a feed slug like 'markets'/'top'), then bind the handle(s). Bind several to aggregate; each item is labeled with its source.",
      trust: "core",
    },
    validateSpec: validateNewsSpec,
  },
  {
    manifest: {
      type: "releases",
      specSchema: { scope: "string — optional label for the calendar" },
      requiresShape: ["releases"],
      title: "Release calendar (point-in-time)",
      description:
        "Dated events with an expected-vs-actual: a point-in-time calendar over bound `releases` handles (reference period, scheduled/released/revised status, forecast vs actual numbers). Use this for anything with a RELEASE DATE and an estimate/actual — earnings EPS & revenue, macro prints. Fetch with data_fetch {shape:'releases', entity:<series-or-ticker>} (sources: finnhub earnings by ticker — emits both EPS and revenue with consensus estimates; fred macro series e.g. GDP/CPIAUCSL/UNRATE — these carry the full ALFRED revision history, every estimate preserved as a vintage, but NO consensus forecast). Bitemporal: revisions are kept as vintages, so the calendar can be read 'as of' any past date and the latest print is shown by default. NOT for static/continuous facts like P/E or market cap — those go on a key_stats panel.",
      trust: "core",
    },
    validateSpec: validateReleasesSpec,
  },
  {
    manifest: {
      type: "key_stats",
      specSchema: { scope: "string — optional label for the panel" },
      requiresShape: ["key_stats"],
      title: "Key statistics",
      description:
        "What a company IS right now: a key-statistics panel over a bound `key_stats` handle (cross-section snapshot) — valuation (P/E, P/S, P/B, EPS, dividend yield), trading (52-week high/low, beta, avg volume), and profile (sector, market cap, shares outstanding). Use this for static or continuously-moving descriptive facts that have no release date. Fetch with data_fetch {shape:'key_stats', entity:<ticker>} (source: finnhub), then bind. Refresh re-snapshots (vintages accrue). NOT for dated estimate/actual events like EPS — those go on a releases calendar.",
      trust: "core",
    },
    validateSpec: validateKeyStatsSpec,
  },
];
