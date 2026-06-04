import type {
  ColumnSpec,
  Shape,
  ShapeSummary,
  ValidationError,
  ValidationResult,
} from "@mu/protocol";

/**
 * One canonical key-stat row (shapes.md) — a single field of a company snapshot for
 * one vintage. The logical row is `field`; `as_of` is when this vintage was captured
 * (epoch-ms UTC). A refresh re-snapshots: same `as_of` upserts a field, a new `as_of`
 * adds a vintage. `value` is stored **display-ready as a string** so mixed types (a
 * P/E `42.3`, a market cap `$2.10T`, a sector `Technology`) coexist in one column and
 * the card stays dumb. This is the `cross-section` kind — point-in-time with the
 * reference-period dimension collapsed.
 */
export interface KeyStatRecord extends Record<string, unknown> {
  /** machine field id, e.g. "peTTM" — the within-snapshot row identity. */
  field: string;
  /** reader-friendly label, e.g. "P/E (TTM)". */
  label: string;
  /** display-ready value string, e.g. "42.31", "$2.10T", "Technology". */
  value: string;
  /** vintage: epoch-ms when this snapshot was captured. */
  as_of: number;
  /** panel bucket, e.g. "valuation" | "trading" | "profile". */
  group?: string;
}

const COLUMNS: readonly ColumnSpec[] = [
  { name: "field", type: "string" },
  { name: "label", type: "string" },
  { name: "value", type: "string" },
  { name: "as_of", type: "int64" },
  { name: "group", type: "string", nullable: true },
];

function checkRow(row: unknown, i: number, errors: ValidationError[]): void {
  if (typeof row !== "object" || row === null) {
    errors.push({ path: `[${i}]`, message: "row must be an object" });
    return;
  }
  const r = row as Record<string, unknown>;
  for (const f of ["field", "label", "value"] as const) {
    if (typeof r[f] !== "string" || (r[f] as string).length === 0) {
      errors.push({ path: `[${i}].${f}`, message: "must be a non-empty string" });
    }
  }
  const t = r["as_of"];
  if (typeof t !== "number" || !Number.isInteger(t)) {
    errors.push({ path: `[${i}].as_of`, message: "must be an integer epoch-ms" });
  }
  const g = r["group"];
  if (g !== undefined && g !== null && typeof g !== "string") {
    errors.push({ path: `[${i}].group`, message: "must be a string when present" });
  }
}

/**
 * The `key_stats` shape — a `cross-section` of a company's statistics. Vintages
 * accrue: ingest dedupes by `(as_of, field)`, so a re-snapshot upserts a field and a
 * new `as_of` adds a vintage; nothing is lost. The store can answer "the snapshot as
 * of date D" (the as-of read); the card shows the newest vintage. One shape, many
 * resources (Finnhub today).
 */
export const keyStatsShape: Shape<KeyStatRecord> = {
  id: "key_stats",
  kind: "cross-section",
  identityTail: [],
  columns: COLUMNS,
  merge: { kind: "cross-section", asOfKey: "as_of", idKey: "field" },
  contractVersion: 1,

  summarize(rows: readonly KeyStatRecord[]): ShapeSummary {
    if (rows.length === 0) return { rowCount: 0 };
    // rows arrive ordered by as_of ascending (storage ORDER BY timeKey).
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    const fields = new Set(rows.map((r) => r.field));
    return {
      rowCount: rows.length,
      firstT: first.as_of,
      lastT: last.as_of,
      statCount: fields.size,
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
