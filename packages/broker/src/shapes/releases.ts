import type {
  ColumnSpec,
  Shape,
  ShapeSummary,
  ValidationError,
  ValidationResult,
} from "@mu/protocol";

/**
 * One canonical point-in-time release row (shapes.md) — a single *vintage* of a
 * release. The logical event is `(event, reference_period)`; `as_of` is when this
 * vintage became known (epoch-ms UTC). A revision is a NEW row with a later
 * `as_of`, never an overwrite — that is what makes the data bitemporal: you can
 * ask what was known *as of* any date. `forecast`/`actual` are real numbers (+ a
 * `unit`) so the card can compute the surprise.
 */
export interface ReleaseRecord extends Record<string, unknown> {
  /** stable event id, e.g. "GDP" (a FRED series) or "AMZN-EPS" (an earnings line). */
  event: string;
  /** human label, e.g. "Real GDP", "Amazon EPS". */
  name: string;
  /** the period the value describes, e.g. "2026 Q1", "may 2026", "2026-01-01". */
  reference_period: string;
  /** vintage: epoch-ms when this row became known (the bitemporal axis). */
  as_of: number;
  /** scheduled/actual release timestamp (epoch-ms) — orders the calendar. */
  release_time: number;
  status: "scheduled" | "released" | "revised";
  forecast?: number;
  actual?: number;
  previous?: number;
  /** value unit, e.g. "%", "index", "USD", "EPS". */
  unit?: string;
  importance?: "high" | "med" | "low";
}

const COLUMNS: readonly ColumnSpec[] = [
  { name: "event", type: "string" },
  { name: "name", type: "string" },
  { name: "reference_period", type: "string" },
  { name: "as_of", type: "int64" },
  { name: "release_time", type: "int64" },
  { name: "status", type: "string" },
  { name: "forecast", type: "float64", nullable: true },
  { name: "actual", type: "float64", nullable: true },
  { name: "previous", type: "float64", nullable: true },
  { name: "unit", type: "string", nullable: true },
  { name: "importance", type: "string", nullable: true },
];

const STATUS = new Set(["scheduled", "released", "revised"]);

function checkRow(row: unknown, i: number, errors: ValidationError[]): void {
  if (typeof row !== "object" || row === null) {
    errors.push({ path: `[${i}]`, message: "row must be an object" });
    return;
  }
  const r = row as Record<string, unknown>;
  for (const f of ["event", "name", "reference_period"] as const) {
    if (typeof r[f] !== "string" || (r[f] as string).length === 0) {
      errors.push({ path: `[${i}].${f}`, message: "must be a non-empty string" });
    }
  }
  for (const f of ["as_of", "release_time"] as const) {
    const v = r[f];
    if (typeof v !== "number" || !Number.isInteger(v)) {
      errors.push({ path: `[${i}].${f}`, message: "must be an integer epoch-ms" });
    }
  }
  if (typeof r["status"] !== "string" || !STATUS.has(r["status"] as string)) {
    errors.push({ path: `[${i}].status`, message: "must be scheduled|released|revised" });
  }
  for (const f of ["forecast", "actual", "previous"] as const) {
    const v = r[f];
    if (v !== undefined && v !== null && (typeof v !== "number" || !Number.isFinite(v))) {
      errors.push({ path: `[${i}].${f}`, message: "must be a finite number when present" });
    }
  }
}

/**
 * The `releases` shape — a point-in-time (bitemporal) release calendar. Vintages
 * accrue: ingest appends a row per `(event, reference_period, as_of)` and never
 * overwrites a prior vintage, so revisions are preserved. The store can answer
 * "what was known as of date D" (the as-of read); the calendar orders by
 * `release_time`. One shape, many resources (FRED econ, Finnhub earnings, …).
 */
export const releasesShape: Shape<ReleaseRecord> = {
  id: "releases",
  kind: "point-in-time",
  identityTail: [],
  columns: COLUMNS,
  merge: {
    kind: "point-in-time",
    eventKey: "event",
    referenceKey: "reference_period",
    asOfKey: "as_of",
    timeKey: "release_time",
  },
  contractVersion: 1,

  summarize(rows: readonly ReleaseRecord[]): ShapeSummary {
    if (rows.length === 0) return { rowCount: 0 };
    // rows arrive ordered by release_time ascending (storage ORDER BY timeKey).
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    const events = new Set(rows.map((r) => r.event));
    return {
      rowCount: rows.length,
      firstT: first.release_time,
      lastT: last.release_time,
      eventCount: events.size,
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
