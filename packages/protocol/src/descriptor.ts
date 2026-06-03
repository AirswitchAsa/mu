import type { Identity } from "./handle.js";

/**
 * ResourceDescriptor — what a `#Resource` declares about a *single dataset it can
 * produce* (resource-descriptor.dog.md). Its `identity` block feeds
 * `encodeHandle`; `queryParams` are recorded in provenance but are **never** part
 * of identity.
 */
export interface ResourceDescriptor {
  /** the shape id the payload conforms to (`ohlcv`, `metric`, …). */
  readonly shape: string;
  /** ordered identity components for the shape's kind; concrete provider by now. */
  readonly identity: Identity;
  /** the params that drove the pull (`start`/`end`/`range`, filters). */
  readonly queryParams: Record<string, unknown>;
}
