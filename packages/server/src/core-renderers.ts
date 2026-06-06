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
 * grid spec — a cross-sectional data table. For `options_chain` it is the calls │
 * strike │ puts ladder; `expiry` selects the slice, `heat` the heat-shaded metric.
 */
export function validateGridSpec(spec: Record<string, unknown>): ValidationResult {
  if (spec["expiry"] !== undefined && typeof spec["expiry"] !== "string") return fail("expiry", "must be a string (YYYY-MM-DD)");
  const heat = spec["heat"];
  if (heat !== undefined && !["iv", "volume", "open_interest"].includes(heat as string)) {
    return fail("heat", "must be 'iv' | 'volume' | 'open_interest'");
  }
  return OK;
}

/**
 * curve spec — a generic xy line over a non-time axis (smile / term structure).
 * Either projection (`x`/`y`/`series`/`where`) or reduce (`reduce.groupBy` + `pick`).
 */
export function validateCurveSpec(spec: Record<string, unknown>): ValidationResult {
  if (spec["x"] !== undefined && typeof spec["x"] !== "string") return fail("x", "must be a string column name");
  const y = spec["y"];
  if (y !== undefined && typeof y !== "string" && !(Array.isArray(y) && y.every((v) => typeof v === "string"))) {
    return fail("y", "must be a string or string[] of column names");
  }
  if (spec["series"] !== undefined && typeof spec["series"] !== "string") return fail("series", "must be a string column name");
  const where = spec["where"];
  if (where !== undefined && (typeof where !== "object" || where === null || Array.isArray(where))) {
    return fail("where", "must be an object of column→value equalities");
  }
  const reduce = spec["reduce"];
  if (reduce !== undefined) {
    if (typeof reduce !== "object" || reduce === null) return fail("reduce", "must be an object");
    const r = reduce as Record<string, unknown>;
    if (typeof r["groupBy"] !== "string") return fail("reduce.groupBy", "must be a string column name");
    const pick = r["pick"];
    if (pick !== undefined) {
      const p = pick as Record<string, unknown>;
      if (typeof p !== "object" || pick === null || typeof p["column"] !== "string" || typeof p["target"] !== "string") {
        return fail("reduce.pick", "must be { column: string, target: string }");
      }
    }
  }
  for (const k of ["xLabel", "yLabel"]) {
    if (spec[k] !== undefined && typeof spec[k] !== "string") return fail(k, "must be a string");
  }
  if (spec["yFormat"] !== undefined && !["pct", "num", "auto"].includes(spec["yFormat"] as string)) {
    return fail("yFormat", "must be 'pct' | 'num' | 'auto'");
  }
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
        "A scrolling wire of headlines (source · time · tickers) over one or more bound `news` handles. Fetch a feed with data_fetch {shape:'news', entity:<ticker>} (sources: yahoo per-ticker, finnhub per-ticker; cnbc general — entity is a feed slug like 'markets'/'top'), then bind the handle(s). Each handle carries a namespace in its tail — `ticker` (per-company), `market` (broad market/macro: cnbc top/markets/economy/finance/investing/business), or `sector` (cnbc technology/earnings); pass data_fetch {kind:…} to override, else it's defaulted per source. Bind several to aggregate; the same story carried by multiple sources is collapsed to one row (richest-metadata copy kept).",
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
  {
    manifest: {
      type: "grid",
      specSchema: {
        expiry: "string (YYYY-MM-DD) — which expiry to show; omit for the nearest",
        heat: "'iv' | 'volume' | 'open_interest' — column to heat-shade cells by (default 'iv')",
      },
      requiresShape: ["options_chain"],
      title: "Options chain",
      description:
        "The full options board for one expiry as a calls │ strike │ puts ladder (ATM row centered + highlighted, cells heat-shaded). Fetch with data_fetch {source:'orats', shape:'options_chain', entity:<ticker>} then bind the handle. spec: { expiry?: 'YYYY-MM-DD' (one of the chain's expiries; omit for nearest), heat?: 'iv'|'volume'|'open_interest' }. canvas_update spec.expiry to switch expiry — no refetch. For the IV smile and term structure of the SAME chain, bind the same handle to a `curve` card alongside.",
      trust: "core",
    },
    validateSpec: validateGridSpec,
  },
  {
    manifest: {
      type: "curve",
      specSchema: {
        x: "string — x-axis column (e.g. 'strike' for a smile, 'dte' for a term structure)",
        y: "string | string[] — y-axis column(s), e.g. 'smv' (fitted vol) or 'iv'",
        series: "string — split into one curve per distinct value (e.g. 'right' → call vs put)",
        where: "object — keep only rows matching predicates: a scalar is an equality ({ expiry: '2026-06-19' }); an object is a numeric range ({ strike: { min: 240, max: 380 } }) to window a smile near spot",
        reduce: "{ groupBy: string, pick?: { column: string, target: string } } — collapse each group to the row whose pick.column is nearest pick.target (term structure)",
        yFormat: "'pct' | 'num' | 'auto' — y label format (vols default to %)",
        xLabel: "string — optional x-axis title",
      },
      requiresShape: ["options_chain"],
      title: "Curve (smile / term structure)",
      description:
        "A line chart over a NON-time numeric axis — for the IV smile/skew and the vol term structure. Bind the SAME orats:options_chain handle as the grid. IV SMILE for one expiry: spec { x:'strike', y:'smv', series:'right', where:{ expiry:'YYYY-MM-DD', strike:{ min:<~0.8×spot>, max:<~1.2×spot> } }, xLabel:'strike' } — use 'smv' (the fitted vol) for a clean curve ('iv' is the raw market mid, 0 where illiquid), and WINDOW the strikes to a band around spot (the chain's `underlying`) so the illiquid deep wings don't flatten the curve. TERM STRUCTURE (ATM vol vs expiry): spec { x:'dte', y:'smv', reduce:{ groupBy:'expiry', pick:{ column:'strike', target:'underlying' } }, xLabel:'days to expiry' }. Generic column algebra over rows — not options-specific.",
      trust: "core",
    },
    validateSpec: validateCurveSpec,
  },
];
