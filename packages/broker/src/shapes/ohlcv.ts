import type {
  ColumnSpec,
  Shape,
  ShapeSummary,
  ValidationError,
  ValidationResult,
} from "@mu/protocol";

/** One canonical OHLCV bar (shapes.md). Time is epoch-ms UTC. */
export interface OhlcvRecord extends Record<string, unknown> {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** split/dividend-adjusted close. */
  adjClose: number;
  volume: number;
  /** cumulative adjustment factor; optional. */
  factor?: number;
}

const COLUMNS: readonly ColumnSpec[] = [
  { name: "t", type: "int64" },
  { name: "open", type: "float64" },
  { name: "high", type: "float64" },
  { name: "low", type: "float64" },
  { name: "close", type: "float64" },
  { name: "adjClose", type: "float64" },
  { name: "volume", type: "float64" },
  { name: "factor", type: "float64", nullable: true },
];

const REQUIRED_NUMERIC = ["open", "high", "low", "close", "adjClose", "volume"] as const;

function checkRow(row: unknown, i: number, errors: ValidationError[]): void {
  if (typeof row !== "object" || row === null) {
    errors.push({ path: `[${i}]`, message: "row must be an object" });
    return;
  }
  const r = row as Record<string, unknown>;
  const t = r["t"];
  if (typeof t !== "number" || !Number.isInteger(t)) {
    errors.push({ path: `[${i}].t`, message: "t must be an integer epoch-ms" });
  }
  for (const f of REQUIRED_NUMERIC) {
    const v = r[f];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      errors.push({ path: `[${i}].${f}`, message: "must be a finite number" });
    }
  }
  const factor = r["factor"];
  if (factor !== undefined && factor !== null && (typeof factor !== "number" || !Number.isFinite(factor))) {
    errors.push({ path: `[${i}].factor`, message: "must be a finite number when present" });
  }
  // Cheap "data fits the chart" sanity: a bar's high cannot be below its low.
  const hi = r["high"];
  const lo = r["low"];
  if (typeof hi === "number" && typeof lo === "number" && hi < lo) {
    errors.push({ path: `[${i}]`, message: `high (${hi}) < low (${lo})` });
  }
}

/**
 * The `ohlcv` shape — price/volume bars (shapes.md). Series kind, merged by `t`.
 * `volume` is stored as float64 to dodge the bigint edge while keeping it numeric;
 * it is conceptually integral.
 */
export const ohlcvShape: Shape<OhlcvRecord> = {
  id: "ohlcv",
  kind: "series",
  identityTail: ["resolution"],
  columns: COLUMNS,
  merge: { kind: "series", timeKey: "t" },
  contractVersion: 1,

  validate(payload: unknown): ValidationResult {
    if (!Array.isArray(payload)) {
      return { ok: false, errors: [{ path: "", message: "payload must be an array" }] };
    }
    const errors: ValidationError[] = [];
    payload.forEach((row, i) => checkRow(row, i, errors));
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  },

  summarize(rows: readonly OhlcvRecord[]): ShapeSummary {
    if (rows.length === 0) return { rowCount: 0 };
    let low = Infinity;
    let high = -Infinity;
    for (const r of rows) {
      if (r.low < low) low = r.low;
      if (r.high > high) high = r.high;
    }
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    return {
      rowCount: rows.length,
      firstT: first.t,
      lastT: last.t,
      latestClose: last.close,
      low,
      high,
    };
  },
};
