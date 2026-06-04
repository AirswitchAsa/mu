import type {
  ColumnSpec,
  Shape,
  ShapeSummary,
  ValidationError,
  ValidationResult,
} from "@mu/protocol";

/**
 * One canonical news/wire item (shapes.md). `published_at` is epoch-ms UTC. A
 * resource normalizes any vendor feed (RSS, Finnhub, …) to this. `tickers` is a
 * comma-joined symbol list ("AMZN,MSFT") so it stores as one scalar column and the
 * client splits it. Optional fields may be empty when a feed doesn't carry them.
 */
export interface NewsRecord extends Record<string, unknown> {
  /** stable per-article id (vendor id, guid, or url) — the merge/dedupe key. */
  id: string;
  published_at: number;
  /** outlet/source label, e.g. "reuters", "cnbc". */
  source: string;
  headline: string;
  summary?: string;
  url?: string;
  /** comma-joined tagged symbols, e.g. "AMZN,MSFT" (or "" for an untagged item). */
  tickers?: string;
  image_url?: string;
  /** [-1,1] sentiment when a feed provides it; absent otherwise. */
  sentiment?: number;
}

const COLUMNS: readonly ColumnSpec[] = [
  { name: "id", type: "string" },
  { name: "published_at", type: "int64" },
  { name: "source", type: "string" },
  { name: "headline", type: "string" },
  { name: "summary", type: "string", nullable: true },
  { name: "url", type: "string", nullable: true },
  { name: "tickers", type: "string", nullable: true },
  { name: "image_url", type: "string", nullable: true },
  { name: "sentiment", type: "float64", nullable: true },
];

function checkRow(row: unknown, i: number, errors: ValidationError[]): void {
  if (typeof row !== "object" || row === null) {
    errors.push({ path: `[${i}]`, message: "row must be an object" });
    return;
  }
  const r = row as Record<string, unknown>;
  if (typeof r["id"] !== "string" || r["id"].length === 0) {
    errors.push({ path: `[${i}].id`, message: "id must be a non-empty string" });
  }
  const t = r["published_at"];
  if (typeof t !== "number" || !Number.isInteger(t)) {
    errors.push({ path: `[${i}].published_at`, message: "must be an integer epoch-ms" });
  }
  if (typeof r["source"] !== "string") errors.push({ path: `[${i}].source`, message: "must be a string" });
  if (typeof r["headline"] !== "string" || r["headline"].length === 0) {
    errors.push({ path: `[${i}].headline`, message: "headline must be a non-empty string" });
  }
  // optional strings must be strings when present (trust-but-verify at ingest).
  for (const f of ["summary", "url", "tickers", "image_url"] as const) {
    const v = r[f];
    if (v !== undefined && v !== null && typeof v !== "string") {
      errors.push({ path: `[${i}].${f}`, message: "must be a string when present" });
    }
  }
  const s = r["sentiment"];
  if (s !== undefined && s !== null && (typeof s !== "number" || !Number.isFinite(s) || s < -1 || s > 1)) {
    errors.push({ path: `[${i}].sentiment`, message: "must be a finite number in [-1, 1] when present" });
  }
}

/**
 * The `news` shape — an event-list of headlines (shapes.md). Upserted by `id`
 * (a re-fetch of the same article is a no-op; a correction overwrites), ordered by
 * `published_at`. One shape, many resources (Yahoo/CNBC RSS, Finnhub, …).
 */
export const newsShape: Shape<NewsRecord> = {
  id: "news",
  kind: "event-list",
  identityTail: [],
  columns: COLUMNS,
  merge: { kind: "event-list", idKey: "id", timeKey: "published_at" },
  contractVersion: 1,

  validate(payload: unknown): ValidationResult {
    if (!Array.isArray(payload)) {
      return { ok: false, errors: [{ path: "", message: "payload must be an array" }] };
    }
    const errors: ValidationError[] = [];
    payload.forEach((row, i) => checkRow(row, i, errors));
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  },

  summarize(rows: readonly NewsRecord[]): ShapeSummary {
    if (rows.length === 0) return { rowCount: 0 };
    // rows arrive ordered by published_at ascending (storage ORDER BY timeKey).
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    return {
      rowCount: rows.length,
      firstT: first.published_at,
      lastT: last.published_at,
      latestHeadline: last.headline,
    };
  },
};
