import type { ShapeSummary } from "./shape.js";

/**
 * ViewSlice — the optional bounded read request to `data_view` (view-slice.dog.md).
 * A narrowing request, not a query language: it cannot join, aggregate, or
 * compute. Absent → `data_view` returns the shape's default summary.
 */
export interface ViewSlice {
  /** restrict to records in an epoch-ms range (series / event-list). */
  readonly timeRange?: { readonly start?: number; readonly end?: number };
  /** the most recent N records (the "latest close / five headlines" case). */
  readonly last?: number;
  /** which snapshot to read (cross-section); defaults to latest. */
  readonly asOf?: string;
  /** shape-specific narrowing (e.g. one expiry, a strike band). */
  readonly filter?: Record<string, unknown>;
  /** project a subset of fields to shrink the response. */
  readonly fields?: readonly string[];
}

/**
 * ViewResult — what `data_view` returns. Either bounded rows (slice within the
 * guard) or a summary; `degraded` marks an over-broad slice that was **refused**
 * and summarized rather than dumped (the bulk guard). Raw bulk never reaches the
 * agent's context.
 */
export interface ViewResult {
  readonly handle: string;
  readonly summary: ShapeSummary;
  readonly rows?: readonly Record<string, unknown>[];
  readonly degraded: boolean;
  readonly reason?: string;
}
