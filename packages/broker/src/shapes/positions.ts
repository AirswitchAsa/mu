import type {
  ColumnSpec,
  Shape,
  ShapeSummary,
  ValidationError,
  ValidationResult,
} from "@mu/protocol";

/**
 * One canonical positions row (shapes.md) — a single **open holding** in a brokerage
 * account for one snapshot vintage. The within-snapshot row identity is `symbol`;
 * `as_of` is when this snapshot was captured (epoch-ms UTC).
 *
 * This is the `cross-section` kind (the `key_stats` pattern): `as_of` is a column, the
 * handle is stable (`alpaca:positions:PORTFOLIO`), and vintages accumulate so a refresh
 * re-snapshots the same account rather than minting a handle per as-of. Ingest dedupes
 * by `(as_of, symbol)`, so re-snapshotting a vintage upserts a holding and a new `as_of`
 * adds a vintage; a position that has been closed simply drops out of the next snapshot.
 * The entity in the handle is the **account/portfolio**, not a ticker — a brokerage
 * handle is per-account, not per-instrument.
 */
export interface PositionRecord extends Record<string, unknown> {
  /** ticker of the holding — the within-snapshot row identity. */
  symbol: string;
  /** signed quantity held (positive long, negative short). */
  qty: number;
  /** `"long"` | `"short"`. */
  side: string;
  /** average entry price (per-share cost basis). */
  avg_entry: number;
  /** latest mark for the holding. */
  price: number;
  /** current market value of the position. */
  market_value: number;
  /** total cost basis of the position. */
  cost_basis: number;
  /** open (unrealized) P/L in account currency. */
  unrealized_pl: number;
  /** open P/L as a fraction of cost basis (e.g. 0.124 = +12.4%). */
  unrealized_plpc: number;
  /** the position's day return as a fraction. */
  change_today: number;
  /** asset class, e.g. `"us_equity"` | `"crypto"`. */
  asset_class: string;
  /** vintage: epoch-ms when this snapshot was captured. */
  as_of: number;
}

const COLUMNS: readonly ColumnSpec[] = [
  { name: "symbol", type: "string" },
  { name: "qty", type: "float64" },
  { name: "side", type: "string" },
  { name: "avg_entry", type: "float64" },
  { name: "price", type: "float64" },
  { name: "market_value", type: "float64" },
  { name: "cost_basis", type: "float64" },
  { name: "unrealized_pl", type: "float64" },
  { name: "unrealized_plpc", type: "float64" },
  { name: "change_today", type: "float64" },
  { name: "asset_class", type: "string" },
  { name: "as_of", type: "int64" },
];

const NUMERIC: readonly (keyof PositionRecord)[] = [
  "qty",
  "avg_entry",
  "price",
  "market_value",
  "cost_basis",
  "unrealized_pl",
  "unrealized_plpc",
  "change_today",
];

function checkRow(row: unknown, i: number, errors: ValidationError[]): void {
  if (typeof row !== "object" || row === null) {
    errors.push({ path: `[${i}]`, message: "row must be an object" });
    return;
  }
  const r = row as Record<string, unknown>;
  for (const f of ["symbol", "asset_class"] as const) {
    if (typeof r[f] !== "string" || (r[f] as string).length === 0) {
      errors.push({ path: `[${i}].${f}`, message: "must be a non-empty string" });
    }
  }
  if (r["side"] !== "long" && r["side"] !== "short") {
    errors.push({ path: `[${i}].side`, message: "must be 'long' or 'short'" });
  }
  for (const f of NUMERIC) {
    const v = r[f];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      errors.push({ path: `[${i}].${String(f)}`, message: "must be a finite number" });
    }
  }
  const t = r["as_of"];
  if (typeof t !== "number" || !Number.isInteger(t)) {
    errors.push({ path: `[${i}].as_of`, message: "must be an integer epoch-ms" });
  }
}

/**
 * The `positions` shape — a `cross-section` snapshot of a brokerage account's open
 * holdings. Vintages accrue: ingest dedupes by `(as_of, symbol)`, so re-snapshotting
 * upserts a holding and a new `as_of` adds a vintage; the card shows the newest `as_of`.
 * One shape, many resources (Alpaca today). The account **balances** are scalars that
 * ride the `key_stats` shape; the **equity curve** is a time path on `ohlcv` — neither
 * is a separate shape.
 */
export const positionsShape: Shape<PositionRecord> = {
  id: "positions",
  kind: "cross-section",
  identityTail: [],
  columns: COLUMNS,
  merge: { kind: "cross-section", asOfKey: "as_of", idKey: "symbol" },
  contractVersion: 1,

  summarize(rows: readonly PositionRecord[]): ShapeSummary {
    if (rows.length === 0) return { rowCount: 0 };
    // rows arrive ordered by as_of ascending (storage ORDER BY timeKey).
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    const symbols = new Set(rows.map((r) => r.symbol));
    return {
      rowCount: rows.length,
      firstT: first.as_of,
      lastT: last.as_of,
      positionCount: symbols.size,
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
