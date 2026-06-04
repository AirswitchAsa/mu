import type { OhlcvRow } from "./types";

// =============================================================================
// µ — indicator compute (pure, headless-testable)
//
// One entry in the COMPUTE map per catalog indicator (@mu/protocol INDICATORS).
// Each fn takes OHLCV rows + resolved params and returns a list of drawable
// OUTPUTS (a line, or a histogram). The renderer is generic over these: price
// indicators draw their outputs on the candle axis, pane indicators in their own
// axed sub-pane. Adding an indicator = a catalog entry + a COMPUTE fn here.
//
// All math is framework-free so it unit-tests without a browser. Times are
// emitted in epoch-SECONDS (broker rows carry epoch-MILLIS → ÷1000 here), the
// unit Lightweight Charts wants.
// =============================================================================

export interface IndPoint {
  readonly time: number;
  readonly value: number;
}
export interface IndHistPoint {
  readonly time: number;
  readonly value: number;
  /** +1 = up-tinted, -1 = down-tinted (renderer maps to theme colors). */
  readonly dir: number;
}

/** Semantic color slot the renderer resolves against the theme/accent. */
export type IndColorRole = "primary" | "secondary" | "band" | "up" | "down" | "signed" | "volume";

export interface IndicatorOutput {
  /** unique within the indicator instance (e.g. "basis", "upper", "signal"). */
  readonly key: string;
  readonly kind: "line" | "histogram";
  readonly role: IndColorRole;
  readonly data: readonly IndPoint[] | readonly IndHistPoint[];
}

export type ComputeFn = (rows: readonly OhlcvRow[], params: Record<string, number>) => IndicatorOutput[];

// --- small numeric helpers (operate on plain number[] aligned to rows) --------

const sec = (t: number): number => Math.floor(Number(t) / 1000);
const r2 = (n: number): number => Math.round(n * 100) / 100;
type Maybe = number | null;

interface Cols {
  readonly time: number[];
  readonly open: number[];
  readonly high: number[];
  readonly low: number[];
  readonly close: number[];
  readonly vol: number[];
  readonly n: number;
}

function cols(rows: readonly OhlcvRow[]): Cols {
  return {
    time: rows.map((r) => sec(r.t)),
    open: rows.map((r) => Number(r.open)),
    high: rows.map((r) => Number(r.high)),
    low: rows.map((r) => Number(r.low)),
    close: rows.map((r) => Number(r.close)),
    vol: rows.map((r) => Number(r.volume ?? 0)),
    n: rows.length,
  };
}

/** zip an aligned value array into line points, dropping null/non-finite slots. */
function line(time: number[], arr: Maybe[], key: string, role: IndColorRole): IndicatorOutput {
  const data: IndPoint[] = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v != null && Number.isFinite(v)) data.push({ time: time[i]!, value: r2(v) });
  }
  return { key, kind: "line", role, data };
}

function smaArr(v: number[], p: number): Maybe[] {
  const out: Maybe[] = new Array(v.length).fill(null);
  if (p <= 0) return out;
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i]!;
    if (i >= p) sum -= v[i - p]!;
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}

function emaArr(v: Maybe[], p: number): Maybe[] {
  const out: Maybe[] = new Array(v.length).fill(null);
  if (p <= 0) return out;
  const k = 2 / (p + 1);
  let prev: number | null = null;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x == null || !Number.isFinite(x)) continue;
    prev = prev == null ? x : x * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing (RMA): seed = SMA of the first p, then recursive average. */
function rmaArr(v: Maybe[], p: number): Maybe[] {
  const out: Maybe[] = new Array(v.length).fill(null);
  if (p <= 0) return out;
  let seedSum = 0;
  let seeded = false;
  let count = 0;
  let prev = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x == null || !Number.isFinite(x)) continue;
    if (!seeded) {
      seedSum += x;
      count++;
      if (count === p) {
        prev = seedSum / p;
        out[i] = prev;
        seeded = true;
      }
    } else {
      prev = (prev * (p - 1) + x) / p;
      out[i] = prev;
    }
  }
  return out;
}

function wmaArr(v: number[], p: number): Maybe[] {
  const out: Maybe[] = new Array(v.length).fill(null);
  if (p <= 0) return out;
  const denom = (p * (p + 1)) / 2;
  for (let i = p - 1; i < v.length; i++) {
    let s = 0;
    for (let j = 0; j < p; j++) s += v[i - p + 1 + j]! * (j + 1);
    out[i] = s / denom;
  }
  return out;
}

function stdArr(v: number[], p: number): Maybe[] {
  const out: Maybe[] = new Array(v.length).fill(null);
  if (p <= 0) return out;
  for (let i = p - 1; i < v.length; i++) {
    let mean = 0;
    for (let j = i - p + 1; j <= i; j++) mean += v[j]!;
    mean /= p;
    let varr = 0;
    for (let j = i - p + 1; j <= i; j++) varr += (v[j]! - mean) ** 2;
    out[i] = Math.sqrt(varr / p);
  }
  return out;
}

function rollMax(v: number[], p: number): Maybe[] {
  const out: Maybe[] = new Array(v.length).fill(null);
  for (let i = p - 1; i < v.length; i++) {
    let m = -Infinity;
    for (let j = i - p + 1; j <= i; j++) m = Math.max(m, v[j]!);
    out[i] = m;
  }
  return out;
}

function rollMin(v: number[], p: number): Maybe[] {
  const out: Maybe[] = new Array(v.length).fill(null);
  for (let i = p - 1; i < v.length; i++) {
    let m = Infinity;
    for (let j = i - p + 1; j <= i; j++) m = Math.min(m, v[j]!);
    out[i] = m;
  }
  return out;
}

/** True range per bar; tr[0] = high-low (no prior close). */
function trArr(c: Cols): number[] {
  const tr: number[] = new Array(c.n);
  for (let i = 0; i < c.n; i++) {
    if (i === 0) tr[i] = c.high[i]! - c.low[i]!;
    else {
      const pc = c.close[i - 1]!;
      tr[i] = Math.max(c.high[i]! - c.low[i]!, Math.abs(c.high[i]! - pc), Math.abs(c.low[i]! - pc));
    }
  }
  return tr;
}

const add = (a: Maybe[], b: Maybe[]): Maybe[] => a.map((x, i) => (x != null && b[i] != null ? x + b[i]! : null));
const sub = (a: Maybe[], b: Maybe[]): Maybe[] => a.map((x, i) => (x != null && b[i] != null ? x - b[i]! : null));
const scale = (a: Maybe[], k: number): Maybe[] => a.map((x) => (x != null ? x * k : null));
const mid = (a: Maybe[], b: Maybe[]): Maybe[] => a.map((x, i) => (x != null && b[i] != null ? (x + b[i]!) / 2 : null));

// --- the compute map ---------------------------------------------------------

export const COMPUTE: Record<string, ComputeFn> = {
  sma: (rows, p) => {
    const c = cols(rows);
    return [line(c.time, smaArr(c.close, p.period!), "basis", "primary")];
  },
  ema: (rows, p) => {
    const c = cols(rows);
    return [line(c.time, emaArr(c.close, p.period!), "basis", "primary")];
  },
  wma: (rows, p) => {
    const c = cols(rows);
    return [line(c.time, wmaArr(c.close, p.period!), "basis", "primary")];
  },
  vwap: (rows) => {
    const c = cols(rows);
    const out: Maybe[] = new Array(c.n).fill(null);
    let cumPV = 0;
    let cumV = 0;
    for (let i = 0; i < c.n; i++) {
      const tp = (c.high[i]! + c.low[i]! + c.close[i]!) / 3;
      cumPV += tp * c.vol[i]!;
      cumV += c.vol[i]!;
      out[i] = cumV > 0 ? cumPV / cumV : tp;
    }
    return [line(c.time, out, "basis", "primary")];
  },
  bollinger: (rows, p) => {
    const c = cols(rows);
    const basis = smaArr(c.close, p.period!);
    const sd = stdArr(c.close, p.period!);
    const band = scale(sd, p.mult!);
    return [
      line(c.time, add(basis, band), "upper", "band"),
      line(c.time, basis, "basis", "primary"),
      line(c.time, sub(basis, band), "lower", "band"),
    ];
  },
  donchian: (rows, p) => {
    const c = cols(rows);
    const upper = rollMax(c.high, p.period!);
    const lower = rollMin(c.low, p.period!);
    return [
      line(c.time, upper, "upper", "band"),
      line(c.time, mid(upper, lower), "basis", "primary"),
      line(c.time, lower, "lower", "band"),
    ];
  },
  keltner: (rows, p) => {
    const c = cols(rows);
    const basis = emaArr(c.close, p.period!);
    const atr = rmaArr(trArr(c), p.period!);
    const band = scale(atr, p.mult!);
    return [
      line(c.time, add(basis, band), "upper", "band"),
      line(c.time, basis, "basis", "primary"),
      line(c.time, sub(basis, band), "lower", "band"),
    ];
  },
  psar: (rows, p) => {
    const c = cols(rows);
    const out: Maybe[] = new Array(c.n).fill(null);
    if (c.n >= 2) {
      let up = c.close[1]! >= c.close[0]!;
      let sar = up ? c.low[0]! : c.high[0]!;
      let ep = up ? c.high[0]! : c.low[0]!;
      let af = p.step!;
      for (let i = 1; i < c.n; i++) {
        sar = sar + af * (ep - sar);
        if (up) {
          if (c.low[i]! < sar) {
            up = false;
            sar = ep;
            ep = c.low[i]!;
            af = p.step!;
          } else if (c.high[i]! > ep) {
            ep = c.high[i]!;
            af = Math.min(p.max!, af + p.step!);
          }
        } else {
          if (c.high[i]! > sar) {
            up = true;
            sar = ep;
            ep = c.high[i]!;
            af = p.step!;
          } else if (c.low[i]! < ep) {
            ep = c.low[i]!;
            af = Math.min(p.max!, af + p.step!);
          }
        }
        out[i] = sar;
      }
    }
    return [line(c.time, out, "dots", "secondary")];
  },
  ichimoku: (rows, p) => {
    const c = cols(rows);
    const conv = mid(rollMax(c.high, p.conversion!), rollMin(c.low, p.conversion!));
    const base = mid(rollMax(c.high, p.base!), rollMin(c.low, p.base!));
    const spanARaw = mid(conv, base);
    const spanBRaw = mid(rollMax(c.high, p.spanB!), rollMin(c.low, p.spanB!));
    const disp = p.displacement!;
    // forward-shift the leading spans, lagging shift the close; clip to range.
    const shift = (arr: Maybe[], by: number): Maybe[] => {
      const out: Maybe[] = new Array(c.n).fill(null);
      for (let i = 0; i < c.n; i++) {
        const j = i - by; // value from index j lands at index i
        if (j >= 0 && j < c.n) out[i] = arr[j]!;
      }
      return out;
    };
    const closeMaybe: Maybe[] = c.close.slice();
    return [
      line(c.time, conv, "tenkan", "primary"),
      line(c.time, base, "kijun", "secondary"),
      line(c.time, shift(spanARaw, disp), "spanA", "band"),
      line(c.time, shift(spanBRaw, disp), "spanB", "band"),
      line(c.time, shift(closeMaybe, -disp), "chikou", "secondary"),
    ];
  },
  supertrend: (rows, p) => {
    const c = cols(rows);
    const atr = rmaArr(trArr(c), p.period!);
    const upLine: Maybe[] = new Array(c.n).fill(null);
    const dnLine: Maybe[] = new Array(c.n).fill(null);
    let prevUpper = Infinity;
    let prevLower = -Infinity;
    let trendUp = true;
    let started = false;
    for (let i = 0; i < c.n; i++) {
      const a = atr[i];
      if (a == null) continue;
      const mids = (c.high[i]! + c.low[i]!) / 2;
      let upper = mids + p.mult! * a;
      let lower = mids - p.mult! * a;
      if (started) {
        upper = c.close[i - 1]! <= prevUpper ? Math.min(upper, prevUpper) : upper;
        lower = c.close[i - 1]! >= prevLower ? Math.max(lower, prevLower) : lower;
        if (trendUp && c.close[i]! < prevLower) trendUp = false;
        else if (!trendUp && c.close[i]! > prevUpper) trendUp = true;
      } else {
        trendUp = c.close[i]! >= mids;
      }
      const v = trendUp ? lower : upper;
      if (trendUp) upLine[i] = v;
      else dnLine[i] = v;
      prevUpper = upper;
      prevLower = lower;
      started = true;
    }
    return [line(c.time, upLine, "up", "up"), line(c.time, dnLine, "down", "down")];
  },

  // --- pane indicators ---
  volume: (rows) => {
    const c = cols(rows);
    const data: IndHistPoint[] = [];
    for (let i = 0; i < c.n; i++) data.push({ time: c.time[i]!, value: c.vol[i]!, dir: c.close[i]! >= c.open[i]! ? 1 : -1 });
    return [{ key: "vol", kind: "histogram", role: "volume", data }];
  },
  rsi: (rows, p) => {
    const c = cols(rows);
    const gain: Maybe[] = new Array(c.n).fill(null);
    const loss: Maybe[] = new Array(c.n).fill(null);
    for (let i = 1; i < c.n; i++) {
      const ch = c.close[i]! - c.close[i - 1]!;
      gain[i] = Math.max(0, ch);
      loss[i] = Math.max(0, -ch);
    }
    const ag = rmaArr(gain, p.period!);
    const al = rmaArr(loss, p.period!);
    const rsi = ag.map((g, i) => {
      if (g == null || al[i] == null) return null;
      const l = al[i]!;
      return l === 0 ? 100 : 100 - 100 / (1 + g / l);
    });
    return [line(c.time, rsi, "rsi", "primary")];
  },
  macd: (rows, p) => {
    const c = cols(rows);
    const macd = sub(emaArr(c.close, p.fast!), emaArr(c.close, p.slow!));
    const signal = emaArr(macd, p.signal!);
    const histArr = sub(macd, signal);
    const hist: IndHistPoint[] = [];
    for (let i = 0; i < c.n; i++) {
      const h = histArr[i];
      if (h != null && Number.isFinite(h)) hist.push({ time: c.time[i]!, value: r2(h), dir: h >= 0 ? 1 : -1 });
    }
    return [
      { key: "hist", kind: "histogram", role: "signed", data: hist },
      line(c.time, macd, "macd", "primary"),
      line(c.time, signal, "signal", "secondary"),
    ];
  },
  stochastic: (rows, p) => {
    const c = cols(rows);
    const hh = rollMax(c.high, p.k!);
    const ll = rollMin(c.low, p.k!);
    const rawK: Maybe[] = c.close.map((cl, i) => {
      if (hh[i] == null || ll[i] == null) return null;
      const range = hh[i]! - ll[i]!;
      return range === 0 ? 50 : (100 * (cl - ll[i]!)) / range;
    });
    const kSmoothArr = smaMaybe(rawK, p.smooth!);
    const dArr = smaMaybe(kSmoothArr, p.d!);
    return [line(c.time, kSmoothArr, "k", "primary"), line(c.time, dArr, "d", "secondary")];
  },
  atr: (rows, p) => {
    const c = cols(rows);
    return [line(c.time, rmaArr(trArr(c), p.period!), "atr", "primary")];
  },
  obv: (rows) => {
    const c = cols(rows);
    const out: Maybe[] = new Array(c.n).fill(null);
    let acc = 0;
    for (let i = 0; i < c.n; i++) {
      if (i > 0) {
        if (c.close[i]! > c.close[i - 1]!) acc += c.vol[i]!;
        else if (c.close[i]! < c.close[i - 1]!) acc -= c.vol[i]!;
      }
      out[i] = acc;
    }
    return [line(c.time, out, "obv", "primary")];
  },
  cci: (rows, p) => {
    const c = cols(rows);
    const tp = c.close.map((cl, i) => (c.high[i]! + c.low[i]! + cl) / 3);
    const ma = smaArr(tp, p.period!);
    const out: Maybe[] = new Array(c.n).fill(null);
    for (let i = p.period! - 1; i < c.n; i++) {
      const m = ma[i]!;
      let dev = 0;
      for (let j = i - p.period! + 1; j <= i; j++) dev += Math.abs(tp[j]! - m);
      dev /= p.period!;
      out[i] = dev === 0 ? 0 : (tp[i]! - m) / (0.015 * dev);
    }
    return [line(c.time, out, "cci", "primary")];
  },
  adx: (rows, p) => {
    const c = cols(rows);
    const plusDM: Maybe[] = new Array(c.n).fill(null);
    const minusDM: Maybe[] = new Array(c.n).fill(null);
    for (let i = 1; i < c.n; i++) {
      const upMove = c.high[i]! - c.high[i - 1]!;
      const downMove = c.low[i - 1]! - c.low[i]!;
      plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
      minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    }
    const tr = trArr(c).map((x, i) => (i === 0 ? null : x)) as Maybe[];
    const atr = rmaArr(tr, p.period!);
    const pdi = rmaArr(plusDM, p.period!).map((x, i) => (x != null && atr[i] ? (100 * x) / atr[i]! : null));
    const mdi = rmaArr(minusDM, p.period!).map((x, i) => (x != null && atr[i] ? (100 * x) / atr[i]! : null));
    const dx = pdi.map((x, i) => {
      if (x == null || mdi[i] == null) return null;
      const s = x + mdi[i]!;
      return s === 0 ? 0 : (100 * Math.abs(x - mdi[i]!)) / s;
    });
    const adx = rmaArr(dx, p.period!);
    return [
      line(c.time, pdi, "plusDI", "up"),
      line(c.time, mdi, "minusDI", "down"),
      line(c.time, adx, "adx", "primary"),
    ];
  },
  williamsr: (rows, p) => {
    const c = cols(rows);
    const hh = rollMax(c.high, p.period!);
    const ll = rollMin(c.low, p.period!);
    const out: Maybe[] = c.close.map((cl, i) => {
      if (hh[i] == null || ll[i] == null) return null;
      const range = hh[i]! - ll[i]!;
      return range === 0 ? -50 : (-100 * (hh[i]! - cl)) / range;
    });
    return [line(c.time, out, "wr", "primary")];
  },
  mfi: (rows, p) => {
    const c = cols(rows);
    const tp = c.close.map((cl, i) => (c.high[i]! + c.low[i]! + cl) / 3);
    const out: Maybe[] = new Array(c.n).fill(null);
    for (let i = p.period!; i < c.n; i++) {
      let pos = 0;
      let neg = 0;
      for (let j = i - p.period! + 1; j <= i; j++) {
        const flow = tp[j]! * c.vol[j]!;
        if (tp[j]! > tp[j - 1]!) pos += flow;
        else if (tp[j]! < tp[j - 1]!) neg += flow;
      }
      out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
    }
    return [line(c.time, out, "mfi", "primary")];
  },
  roc: (rows, p) => {
    const c = cols(rows);
    const out: Maybe[] = new Array(c.n).fill(null);
    for (let i = p.period!; i < c.n; i++) {
      const prev = c.close[i - p.period!]!;
      out[i] = prev === 0 ? 0 : (100 * (c.close[i]! - prev)) / prev;
    }
    return [line(c.time, out, "roc", "primary")];
  },
};

/** SMA over a Maybe[] (tolerates leading nulls), aligned. */
function smaMaybe(v: Maybe[], p: number): Maybe[] {
  const out: Maybe[] = new Array(v.length).fill(null);
  if (p <= 0) return out;
  let sum = 0;
  let count = 0;
  const q: number[] = [];
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x == null || !Number.isFinite(x)) {
      q.length = 0;
      sum = 0;
      count = 0;
      continue;
    }
    q.push(x);
    sum += x;
    count++;
    if (count > p) sum -= q[count - p - 1]!;
    if (count >= p) out[i] = sum / p;
  }
  return out;
}

/**
 * Compute one indicator's drawable outputs. Returns [] only for an unknown name
 * (the catalog is the gate). With NO rows it still returns the output *skeleton*
 * (each output present, data empty) so the renderer can create the series/panes
 * before data resolves and just fill them in on the next render — otherwise a
 * first render with unresolved data would leave the series uncreated.
 */
export function getIndicatorOutputs(name: string, rows: readonly OhlcvRow[], params: Record<string, number>): IndicatorOutput[] {
  const fn = COMPUTE[name];
  if (!fn) return [];
  return fn(rows, params);
}

/** The latest finite value across an indicator's primary output (for legends). */
export function lastValueOf(outputs: IndicatorOutput[]): number | null {
  const primary = outputs.find((o) => o.role === "primary") ?? outputs[0];
  if (!primary || !primary.data.length) return null;
  const last = primary.data[primary.data.length - 1]!;
  return last.value;
}
