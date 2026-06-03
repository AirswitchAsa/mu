import type { ResourceDescriptor } from "./descriptor.js";
import type { Provenance } from "./provenance.js";

/**
 * FetchResult — the single return shape of a `#Resource.fetch` (fetch-result.dog.md).
 * `payload` is the *increment* fetched this call (merge is the shape's job at
 * ingest), already normalized to canonical form — the broker never sees raw
 * vendor formats.
 */
export interface FetchResult {
  readonly descriptor: ResourceDescriptor;
  /** canonical records for `descriptor.shape`: an array for series/event-list,
   *  a full table for a cross-section snapshot. Shape-validated at ingest. */
  readonly payload: readonly Record<string, unknown>[];
  readonly provenance: Provenance;
}
