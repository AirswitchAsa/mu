/**
 * The structural kinds — *how data sits in time* (data-architecture.md §2). The
 * kind selects merge behavior and storage layout; the record schema is the
 * `#Shape`'s concern.
 *
 * - `series` — one value per timestamp, merged by time (ohlcv).
 * - `event-list` — discrete events with a stable id, upserted by id (news).
 * - `point-in-time` — bitemporal: a logical row `(event, reference_period)` whose
 *   value is *revised over time*; each vintage `as_of` is a NEW row, never an
 *   overwrite, so you can ask what was known *as of* a date (releases).
 * - `cross-section` — an accumulating snapshot of an entity's fields: a tall
 *   key-value table `(field → value)` stamped with a vintage `as_of`, re-snapshotted
 *   on refresh (company key-stats). Dedupe `(as_of, field)`; the newest vintage is
 *   "now". (point-in-time with the reference dimension collapsed.)
 */
export type StructuralKind = "series" | "event-list" | "point-in-time" | "cross-section";
