/**
 * The three structural kinds — *how data sits in time* (data-architecture.md §2).
 * The kind selects merge behavior and storage layout; the record schema is the
 * `#Shape`'s concern.
 */
export type StructuralKind = "series" | "event-list" | "cross-section";
