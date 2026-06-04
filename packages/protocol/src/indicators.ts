// @mu/protocol — the indicator catalog.
//
// The SINGLE source of truth for which technical indicators a `price_chart` can
// draw: each one's name, parameters (with defaults + ranges), where it draws
// (on the price axis vs. its own pane), and its display hints. The server
// validates agent specs against this and advertises it via `renderer_list`; the
// web client pairs each `name` with a pure compute fn and a generic renderer.
//
// Adding an indicator = one entry here + one compute fn on the client. The spec
// shape, the validator, and the renderer are untouched.
//
// NOTE: this is a CLOSED, curated vocabulary — the agent picks a name, never
// authors a formula. Freeform/agent-authored compute is deliberately not opened.

export type IndicatorPlacement = "price" | "pane";

export interface IndicatorParam {
  readonly name: string;
  readonly default: number;
  readonly min: number;
  readonly max: number;
  /** integer-valued (most look-back periods); a fractional value is rejected. */
  readonly int?: boolean;
}

export interface IndicatorDef {
  /** catalog key, the value of an `indicators[].name` (e.g. "sma"). */
  readonly name: string;
  /** short display label for legends (e.g. "SMA"). */
  readonly label: string;
  /** "price" → overlaid on the candle axis; "pane" → its own axed sub-pane. */
  readonly placement: IndicatorPlacement;
  readonly params: readonly IndicatorParam[];
  /** fixed value-axis bounds for a bounded oscillator (e.g. RSI 0–100). */
  readonly scale?: { readonly min: number; readonly max: number };
  /** reference levels drawn as horizontal guides (e.g. RSI 30/70). */
  readonly guides?: readonly number[];
  readonly description: string;
}

const period = (def: number, min = 1, max = 400): IndicatorParam => ({ name: "period", default: def, min, max, int: true });
const int = (name: string, def: number, min: number, max: number): IndicatorParam => ({ name, default: def, min, max, int: true });
const num = (name: string, def: number, min: number, max: number): IndicatorParam => ({ name, default: def, min, max });

/**
 * The curated catalog of common technical indicators. Order is the discovery
 * order (price overlays first, then pane oscillators/volume studies).
 */
export const INDICATORS: readonly IndicatorDef[] = [
  // --- price overlays (drawn on the candle price axis) ---
  { name: "sma", label: "SMA", placement: "price", params: [period(50)], description: "Simple moving average of close." },
  { name: "ema", label: "EMA", placement: "price", params: [period(20)], description: "Exponential moving average of close." },
  { name: "wma", label: "WMA", placement: "price", params: [period(20)], description: "Linearly weighted moving average of close." },
  { name: "vwap", label: "VWAP", placement: "price", params: [], description: "Volume-weighted average price (cumulative over the window)." },
  {
    name: "bollinger",
    label: "BB",
    placement: "price",
    params: [period(20), num("mult", 2, 0.5, 5)],
    description: "Bollinger Bands: SMA basis ± mult·stdev (upper / basis / lower).",
  },
  { name: "donchian", label: "DC", placement: "price", params: [period(20)], description: "Donchian channel: highest-high / midline / lowest-low." },
  {
    name: "keltner",
    label: "KC",
    placement: "price",
    params: [period(20), num("mult", 2, 0.5, 5)],
    description: "Keltner channel: EMA basis ± mult·ATR.",
  },
  {
    name: "psar",
    label: "PSAR",
    placement: "price",
    params: [num("step", 0.02, 0.001, 0.2), num("max", 0.2, 0.05, 1)],
    description: "Parabolic SAR trailing stop-and-reverse dots.",
  },
  {
    name: "ichimoku",
    label: "Ichimoku",
    placement: "price",
    params: [int("conversion", 9, 1, 200), int("base", 26, 1, 200), int("spanB", 52, 1, 400), int("displacement", 26, 1, 200)],
    description: "Ichimoku Kinko Hyo: conversion, base, leading spans A/B, lagging span (displacement clipped to loaded range).",
  },
  {
    name: "supertrend",
    label: "SuperTrend",
    placement: "price",
    params: [period(10), num("mult", 3, 0.5, 10)],
    description: "ATR-based trend line that flips on close crossings (green up / red down).",
  },

  // --- own-pane indicators (each gets its own value axis) ---
  { name: "volume", label: "Vol", placement: "pane", params: [], description: "Trade volume histogram, tinted by bar direction." },
  { name: "rsi", label: "RSI", placement: "pane", params: [period(14)], scale: { min: 0, max: 100 }, guides: [30, 70], description: "Relative Strength Index (Wilder)." },
  {
    name: "macd",
    label: "MACD",
    placement: "pane",
    params: [int("fast", 12, 1, 200), int("slow", 26, 1, 400), int("signal", 9, 1, 200)],
    description: "MACD line, signal line, and histogram.",
  },
  {
    name: "stochastic",
    label: "Stoch",
    placement: "pane",
    params: [int("k", 14, 1, 200), int("d", 3, 1, 100), int("smooth", 3, 1, 100)],
    scale: { min: 0, max: 100 },
    guides: [20, 80],
    description: "Stochastic oscillator %K / %D.",
  },
  { name: "atr", label: "ATR", placement: "pane", params: [period(14)], description: "Average True Range (Wilder), in price units." },
  { name: "obv", label: "OBV", placement: "pane", params: [], description: "On-Balance Volume (cumulative)." },
  { name: "cci", label: "CCI", placement: "pane", params: [period(20)], guides: [-100, 100], description: "Commodity Channel Index." },
  { name: "adx", label: "ADX", placement: "pane", params: [period(14)], scale: { min: 0, max: 100 }, guides: [20], description: "Average Directional Index with +DI / −DI." },
  { name: "williamsr", label: "%R", placement: "pane", params: [period(14)], scale: { min: -100, max: 0 }, guides: [-20, -80], description: "Williams %R." },
  { name: "mfi", label: "MFI", placement: "pane", params: [period(14)], scale: { min: 0, max: 100 }, guides: [20, 80], description: "Money Flow Index (volume-weighted RSI)." },
  { name: "roc", label: "ROC", placement: "pane", params: [period(12)], guides: [0], description: "Rate of Change (percent)." },
];

export const INDICATOR_BY_NAME: ReadonlyMap<string, IndicatorDef> = new Map(INDICATORS.map((d) => [d.name, d]));

/** One indicator instance inside a `price_chart` spec's `indicators` list. */
export interface IndicatorSpec {
  readonly name: string;
  readonly params?: Readonly<Record<string, number>>;
}

export type IndicatorValidation =
  | { readonly ok: true; readonly indicators: readonly IndicatorSpec[] }
  | { readonly ok: false; readonly path: string; readonly message: string };

/**
 * Validate a `price_chart` spec's `indicators` against the catalog: every entry
 * must name a known indicator and supply only in-range params (missing params
 * are allowed — the client fills catalog defaults). Pure; the server validator
 * wraps it. `undefined` (no indicators) is valid.
 */
export function validateIndicators(value: unknown): IndicatorValidation {
  if (value === undefined) return { ok: true, indicators: [] };
  if (!Array.isArray(value)) return { ok: false, path: "indicators", message: "must be an array" };
  const out: IndicatorSpec[] = [];
  for (let i = 0; i < value.length; i++) {
    const raw = value[i] as Record<string, unknown> | null;
    const at = `indicators[${i}]`;
    if (typeof raw !== "object" || raw === null) return { ok: false, path: at, message: "must be an object" };
    const name = raw["name"];
    if (typeof name !== "string") return { ok: false, path: `${at}.name`, message: "must be a string" };
    const def = INDICATOR_BY_NAME.get(name);
    if (!def) return { ok: false, path: `${at}.name`, message: `unknown indicator '${name}' (call renderer_list for the catalog)` };
    const params = raw["params"];
    const clean: Record<string, number> = {};
    if (params !== undefined) {
      if (typeof params !== "object" || params === null || Array.isArray(params)) {
        return { ok: false, path: `${at}.params`, message: "must be an object" };
      }
      for (const [key, v] of Object.entries(params as Record<string, unknown>)) {
        const p = def.params.find((pp) => pp.name === key);
        if (!p) return { ok: false, path: `${at}.params.${key}`, message: `unknown param for ${name}` };
        if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, path: `${at}.params.${key}`, message: "must be a number" };
        if (p.int && !Number.isInteger(v)) return { ok: false, path: `${at}.params.${key}`, message: "must be an integer" };
        if (v < p.min || v > p.max) return { ok: false, path: `${at}.params.${key}`, message: `must be in [${p.min}, ${p.max}]` };
        clean[key] = v;
      }
    }
    out.push({ name, params: clean });
  }
  return { ok: true, indicators: out };
}

/** Fill catalog defaults for any params an `IndicatorSpec` left unset. */
export function resolveIndicatorParams(def: IndicatorDef, params?: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of def.params) out[p.name] = params?.[p.name] ?? p.default;
  return out;
}
