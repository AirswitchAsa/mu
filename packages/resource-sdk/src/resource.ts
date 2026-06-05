import type {
  AcquisitionTrigger,
  FetchResult,
  Handle,
  ResourceManifest,
  ShapeSummary,
} from "@mu/protocol";

/**
 * The params a `data_fetch` carries: which canonical `shape` of data, for which
 * `entity`, over what window. `shape` is explicit so the registry can resolve a
 * provider even when the agent omits one.
 */
export interface FetchParams {
  readonly shape: string;
  readonly entity: string;
  readonly resolution?: string;
  readonly range?: string;
  readonly start?: number;
  readonly end?: number;
  /**
   * News-shape namespace (`ticker` | `sector` | `market`), carried into the handle
   * tail so the wire's scope is part of its identity. Optional and resource-defaulted
   * (a per-ticker company feed → `ticker`, a general wire → `market`), so omitting it
   * never breaks resolution. Ignored by non-news shapes.
   */
  readonly kind?: string;
  readonly [k: string]: unknown;
}

/** Server-side context handed to a resource's fetch (keeps acquisition deterministic/testable). */
export interface FetchContext {
  readonly trigger: AcquisitionTrigger;
  /** epoch-ms clock, injectable so provenance stamps are testable. */
  readonly now: () => number;
}

/**
 * Resource — a thin data source (resource.dog.md). It owns exactly two things: a
 * manifest it declares, and `fetch` (acquire → normalize to canonical → return a
 * FetchResult). It does not implement list/view/merge.
 */
export interface Resource {
  readonly manifest: ResourceManifest;
  fetch(params: FetchParams, ctx: FetchContext): Promise<FetchResult>;
  /** present-config check; absent → configured (zero-config resources like yfinance). */
  isConfigured?(): boolean;
}

/**
 * The broker's write path, as the SDK sees it — an injected interface so
 * resource-sdk depends only on @mu/protocol (the runtime wires the real broker).
 */
export interface IngestSink {
  ingest(result: FetchResult): Promise<{ handle: Handle; summary: ShapeSummary }>;
}
