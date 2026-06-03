import type { CandleDatum, HistDatum, LineDatum, OhlcvRow } from "./types";

// =============================================================================
// µ — indicators (pure, headless-testable)
// Every decision about *what* to draw lives here, framework-free, so it can be
// unit-tested without a browser. The renderer plugins only call these + the
// imperative chart API. Lightweight Charts wants epoch-SECONDS, broker rows are
// epoch-MILLIS → we divide by 1000 at this boundary.
// =============================================================================

const sec = (t: number): number => Math.floor(Number(t) / 1000);
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** OHLCV → candlestick series. */
export function toCandles(rows: readonly OhlcvRow[]): CandleDatum[] {
  return rows.map((r) => ({
    time: sec(r.t),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
  }));
}

/** OHLCV → a single value line (default the close). */
export function toLine(rows: readonly OhlcvRow[], field: keyof OhlcvRow = "close"): LineDatum[] {
  return rows.map((r) => ({ time: sec(r.t), value: Number(r[field]) }));
}

/** Simple moving average of close over `period`; emitted once the window fills. */
export function sma(rows: readonly OhlcvRow[], period: number): LineDatum[] {
  if (period <= 0) return [];
  const out: LineDatum[] = [];
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    sum += Number(rows[i]!.close);
    if (i >= period) sum -= Number(rows[i - period]!.close);
    if (i >= period - 1) out.push({ time: sec(rows[i]!.t), value: round2(sum / period) });
  }
  return out;
}

/** Exponential moving average of close; seeded at the first close, emitted for all rows. */
export function ema(rows: readonly OhlcvRow[], period: number): LineDatum[] {
  if (period <= 0 || rows.length === 0) return [];
  const k = 2 / (period + 1);
  const out: LineDatum[] = [];
  let prev = Number(rows[0]!.close);
  for (let i = 0; i < rows.length; i++) {
    const close = Number(rows[i]!.close);
    prev = i === 0 ? close : close * k + prev * (1 - k);
    out.push({ time: sec(rows[i]!.t), value: round2(prev) });
  }
  return out;
}

/** Index-normalize close to a common base (default 100) so shapes compare. */
export function indexNormalize(rows: readonly OhlcvRow[], base = 100): LineDatum[] {
  if (rows.length === 0) return [];
  const first = Number(rows[0]!.close);
  if (first === 0) return [];
  return rows.map((r) => ({ time: sec(r.t), value: round2((Number(r.close) / first) * base) }));
}

/** OHLCV → volume histogram, tinted up/down by the bar's direction. */
export function toVolume(rows: readonly OhlcvRow[], upColor: string, downColor: string): HistDatum[] {
  return rows.map((r) => ({
    time: sec(r.t),
    value: Number(r.volume ?? 0),
    color: Number(r.close) >= Number(r.open) ? upColor : downColor,
  }));
}

/** Trailing percentage change over the full window (for the legend strip). */
export function pctChange(rows: readonly OhlcvRow[]): number {
  if (rows.length < 2) return 0;
  const a = Number(rows[0]!.close);
  const z = Number(rows[rows.length - 1]!.close);
  return a === 0 ? 0 : ((z - a) / a) * 100;
}

/** Latest close in the window (legend price). */
export function lastClose(rows: readonly OhlcvRow[]): number {
  return rows.length ? Number(rows[rows.length - 1]!.close) : 0;
}
