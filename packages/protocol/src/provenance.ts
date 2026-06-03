/**
 * Provenance — the lineage stamp on every dataset (provenance.dog.md). Mandatory:
 * any on-screen number traces back through this to a source.
 */
export type AcquisitionTrigger = "on_demand" | "cadence";

export interface Provenance {
  /** the `#Resource` id that produced the data (e.g. `yfinance`, `tiingo`). */
  readonly source: string;
  /** epoch-ms UTC timestamp of acquisition. */
  readonly fetchedAt: number;
  /** what initiated the fetch — an agent `data_fetch`, or a scheduler tick. */
  readonly trigger: AcquisitionTrigger;
  /** the params the resource was called with (range, filters); audit, not identity. */
  readonly queryParams: Record<string, unknown>;
  /** optional free-form source detail (vendor request id, URL, as-of) for deep citation. */
  readonly upstream?: Record<string, unknown>;
}
