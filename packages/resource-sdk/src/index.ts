// @mu/resource-sdk — the thin resource author surface + registry + coordinator.
export type { Resource, FetchParams, FetchContext, IngestSink } from "./resource.js";
export { ResourceRegistry, type SourceListing } from "./registry.js";
export { AcquisitionCoordinator, type AcquireResult } from "./coordinator.js";
export {
  loadResources,
  discoverResources,
  type DiscoveredResource,
} from "./loader.js";
