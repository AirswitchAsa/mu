import type { StructuralKind } from "./kind.js";

/** A single validation failure: a JSON-pointer-ish path and a human message. */
export interface ValidationError {
  readonly path: string;
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

/**
 * Logical column type for storage. The broker maps these to physical DuckDB
 * types; protocol stays storage-agnostic (no DuckDB vocabulary leaks here).
 */
export type ColumnType = "int64" | "float64" | "string" | "bool";

export interface ColumnSpec {
  readonly name: string;
  readonly type: ColumnType;
  readonly nullable?: boolean;
}

/**
 * Declarative merge contract, executed by the broker's storage per kind
 * (data-architecture.md §2). The shape declares *semantics*; the broker runs them
 * as SQL so rows never marshal through JS for large datasets.
 */
export type MergeSpec =
  | { readonly kind: "series"; readonly timeKey: string }
  | { readonly kind: "event-list"; readonly idKey: string }
  | { readonly kind: "cross-section"; readonly asOfKey: string };

/** A small, bounded summary of a dataset — safe to return to the agent's context. */
export interface ShapeSummary {
  readonly rowCount: number;
  readonly firstT?: number;
  readonly lastT?: number;
  /** shape-specific reasoning-relevant scalars (e.g. latest close). */
  readonly [k: string]: unknown;
}

/**
 * Shape — the "smart" half of the data contract (shape.dog.md). A registered
 * bundle of pure behavior keyed by shape id and dispatched by the broker: the
 * validate gate, the declarative merge, the default summary, plus the identity
 * tail and storage column schema.
 */
export interface Shape<Rec extends Record<string, unknown> = Record<string, unknown>> {
  /** canonical shape id; the second `&Handle` component. */
  readonly id: string;
  readonly kind: StructuralKind;
  /** ordered identity-tail component names after `provider:shape:entity`. */
  readonly identityTail: readonly string[];
  /** physical column schema for typed parquet storage. */
  readonly columns: readonly ColumnSpec[];
  readonly merge: MergeSpec;
  /** the data-contract version records are written under (`&MetaJson.contractVersion`). */
  readonly contractVersion: number;

  /** the ingest gate — reject off-spec payloads before they are stored. */
  validate(payload: unknown): ValidationResult;
  /** default `data_view` summary when no slice (or a refused slice) is given. */
  summarize(rows: readonly Rec[]): ShapeSummary;
}
