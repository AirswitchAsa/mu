import type { ResourceDescriptor } from "./descriptor.js";
import type { Handle } from "./handle.js";
import type { StructuralKind } from "./kind.js";
import type { Provenance } from "./provenance.js";

/** The time span a dataset covers and when it was last refreshed. */
export interface Freshness {
  readonly firstT: number | null;
  readonly lastT: number | null;
  readonly fetchedAt: number;
}

/**
 * MetaJson — the `meta.json` survey card in every dataset directory
 * (meta-json.dog.md). The **only** thing `data_list` reads for the dataset half
 * of its overview — never the data leaves. Derived state: rebuildable by scanning
 * the data files, so a corrupt sidecar is recoverable.
 */
export interface MetaJson {
  readonly handle: Handle;
  readonly shape: string;
  readonly kind: StructuralKind;
  readonly descriptor: ResourceDescriptor;
  readonly provenance: Provenance;
  readonly freshness: Freshness;
  /**
   * Logical rows in the dataset's current view: the row count for series/event-list,
   * and the latest-vintage row count for point-in-time/cross-section (one per
   * (event, reference) / per field) — not the total accrued vintage count.
   */
  readonly rowCount?: number;
  readonly sizeBytes: number;
  readonly contractVersion: number;
}
