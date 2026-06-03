import {
  MuErrorException,
  type AcquisitionTrigger,
  type Handle,
  type ShapeSummary,
} from "@mu/protocol";
import type { IngestSink, FetchParams } from "./resource.js";
import type { ResourceRegistry } from "./registry.js";

export interface AcquireResult {
  readonly handle: Handle;
  readonly summary: ShapeSummary;
}

function stableKey(resourceId: string, params: FetchParams): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${JSON.stringify(params[k])}`)
    .join("&");
  return `${resourceId}|${sorted}`;
}

/**
 * Turn any thrown fetch failure into a typed, agent-safe error. Already-typed
 * MuErrorExceptions pass through; raw vendor errors are classified and their text
 * is kept *out* of the agent's context (logged server-side instead).
 */
function classify(resourceId: string, err: unknown): MuErrorException {
  if (err instanceof MuErrorException) return err;
  const raw = err instanceof Error ? err.message : String(err);
  // Server-side only — the raw vendor error never reaches the agent.
  console.error(`[acquisition] resource '${resourceId}' fetch failed:`, raw);
  if (/rate.?limit|429|too many requests/i.test(raw)) {
    return new MuErrorException("RATE_LIMITED", `'${resourceId}' is rate-limited; retry later`);
  }
  if (/not configured|unauthorized|401|403|api.?key/i.test(raw)) {
    return new MuErrorException("NOT_CONFIGURED", `'${resourceId}' rejected the request (auth/config)`);
  }
  return new MuErrorException("FETCH_FAILED", `fetch from '${resourceId}' failed`);
}

/**
 * AcquisitionCoordinator — the single funnel for agent-initiated, server-executed
 * acquisition (acquisition-coordinator.dog.md). Resolves the resource, runs fetch
 * server-side, ingests the result, and returns a handle + summary — never the
 * payload. Concurrent identical fetches coalesce via the inflight map.
 */
export class AcquisitionCoordinator {
  private readonly inflight = new Map<string, Promise<AcquireResult>>();

  constructor(
    private readonly registry: ResourceRegistry,
    private readonly broker: IngestSink,
    private readonly now: () => number = () => Date.now(),
  ) {}

  acquire(
    source: string | undefined,
    params: FetchParams,
    trigger: AcquisitionTrigger = "on_demand",
  ): Promise<AcquireResult> {
    // resolveProvider throws typed errors (UNKNOWN_SOURCE / NOT_CONFIGURED).
    const resource = this.registry.resolveProvider(params.shape, params.entity, source);
    const key = stableKey(resource.manifest.id, params);

    const existing = this.inflight.get(key);
    if (existing) return existing;

    const run = (async (): Promise<AcquireResult> => {
      let result;
      try {
        result = await resource.fetch(params, { trigger, now: this.now });
      } catch (err) {
        throw classify(resource.manifest.id, err);
      }
      // ingest may throw VALIDATION_FAILED (already typed).
      return this.broker.ingest(result);
    })();

    this.inflight.set(key, run);
    return run.finally(() => this.inflight.delete(key));
  }
}
