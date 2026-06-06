import type {
  ColumnSpec,
  Shape,
  ShapeSummary,
  ValidationError,
  ValidationResult,
} from "@mu/protocol";

/**
 * One canonical options-chain row (shapes.md) — a single **side** of a single strike
 * for one snapshot vintage. The provider gives one row per (expiry, strike) carrying
 * *both* sides; the resource splits it into a `call` row and a `put` row so a renderer
 * filters by `right` instead of de-interleaving columns.
 *
 * This is the `cross-section` kind (the `key_stats` pattern): `as_of` is a column, the
 * handle is stable (`orats:options_chain:AMZN`), and vintages accumulate so a refresh
 * re-snapshots the same chain rather than minting a new handle per as-of. The logical
 * within-snapshot row is `id = "{expiry}|{strike}|{right}"`; ingest dedupes by
 * `(as_of, id)`, so re-snapshotting a vintage upserts and a new `as_of` adds a vintage.
 */
export interface OptionsChainRecord extends Record<string, unknown> {
  /** within-snapshot row identity: `"{expiry}|{strike}|{right}"`. */
  id: string;
  /** expiry date, `YYYY-MM-DD`. */
  expiry: string;
  /** strike price. */
  strike: number;
  /** `"call"` | `"put"`. */
  right: string;
  /** best bid for this side. */
  bid: number;
  /** best ask for this side. */
  ask: number;
  /** `(bid + ask) / 2`. */
  mid: number;
  /** market **mid** implied vol (decimal, e.g. 0.27); 0 when the side has no two-sided market. */
  iv: number;
  /** provider **smoothed/fitted** strike vol — the clean input for a smile curve. */
  smv: number;
  /** delta for this side (call: provider delta; put: delta − 1). */
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  /** open interest for this side. */
  open_interest: number;
  /** traded volume for this side. */
  volume: number;
  /** underlying spot at snapshot. */
  underlying: number;
  /** days to expiry. */
  dte: number;
  /** vintage: epoch-ms when this snapshot was captured. */
  as_of: number;
}

const COLUMNS: readonly ColumnSpec[] = [
  { name: "id", type: "string" },
  { name: "expiry", type: "string" },
  { name: "strike", type: "float64" },
  { name: "right", type: "string" },
  { name: "bid", type: "float64" },
  { name: "ask", type: "float64" },
  { name: "mid", type: "float64" },
  { name: "iv", type: "float64" },
  { name: "smv", type: "float64" },
  { name: "delta", type: "float64" },
  { name: "gamma", type: "float64" },
  { name: "theta", type: "float64" },
  { name: "vega", type: "float64" },
  { name: "open_interest", type: "float64" },
  { name: "volume", type: "float64" },
  { name: "underlying", type: "float64" },
  { name: "dte", type: "int64" },
  { name: "as_of", type: "int64" },
];

const NUMERIC: readonly (keyof OptionsChainRecord)[] = [
  "strike",
  "bid",
  "ask",
  "mid",
  "iv",
  "smv",
  "delta",
  "gamma",
  "theta",
  "vega",
  "open_interest",
  "volume",
  "underlying",
];

function checkRow(row: unknown, i: number, errors: ValidationError[]): void {
  if (typeof row !== "object" || row === null) {
    errors.push({ path: `[${i}]`, message: "row must be an object" });
    return;
  }
  const r = row as Record<string, unknown>;
  for (const f of ["id", "expiry"] as const) {
    if (typeof r[f] !== "string" || (r[f] as string).length === 0) {
      errors.push({ path: `[${i}].${f}`, message: "must be a non-empty string" });
    }
  }
  if (r["right"] !== "call" && r["right"] !== "put") {
    errors.push({ path: `[${i}].right`, message: "must be 'call' or 'put'" });
  }
  for (const f of NUMERIC) {
    const v = r[f];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      errors.push({ path: `[${i}].${String(f)}`, message: "must be a finite number" });
    }
  }
  for (const f of ["dte", "as_of"] as const) {
    const v = r[f];
    if (typeof v !== "number" || !Number.isInteger(v)) {
      errors.push({ path: `[${i}].${f}`, message: "must be an integer" });
    }
  }
}

/**
 * The `options_chain` shape — a `cross-section` snapshot of an options surface
 * (strikes × expiries × {call,put}). Vintages accrue: ingest dedupes by `(as_of, id)`,
 * so re-snapshotting upserts and a new `as_of` adds a vintage; the directory of
 * vintages *is* the surface history. The card shows the newest `as_of`. One shape,
 * many resources (ORATS today). Derived smile/skew and term structure are projections
 * of this shape drawn by the `curve` renderer — not separate shapes.
 */
export const optionsChainShape: Shape<OptionsChainRecord> = {
  id: "options_chain",
  kind: "cross-section",
  identityTail: [],
  columns: COLUMNS,
  merge: { kind: "cross-section", asOfKey: "as_of", idKey: "id" },
  contractVersion: 1,

  summarize(rows: readonly OptionsChainRecord[]): ShapeSummary {
    if (rows.length === 0) return { rowCount: 0 };
    // rows arrive ordered by as_of ascending (storage ORDER BY timeKey).
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    const strikes = new Set<number>();
    const expiries = new Set<string>();
    for (const r of rows) {
      strikes.add(r.strike);
      expiries.add(r.expiry);
    }
    return {
      rowCount: rows.length,
      firstT: first.as_of,
      lastT: last.as_of,
      strikeCount: strikes.size,
      expiryCount: expiries.size,
    };
  },

  validate(payload: unknown): ValidationResult {
    if (!Array.isArray(payload)) {
      return { ok: false, errors: [{ path: "", message: "payload must be an array" }] };
    }
    const errors: ValidationError[] = [];
    payload.forEach((row, i) => checkRow(row, i, errors));
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  },
};
