import {
  MuErrorException,
  type ResourceAvailability,
  type ResourceManifest,
} from "@mu/protocol";
import type { Resource } from "./resource.js";

/** A source's public view for `data_list` — manifest + availability, no secrets. */
export interface SourceListing {
  readonly manifest: ResourceManifest;
  readonly availability: ResourceAvailability;
}

/**
 * ResourceRegistry — the in-process registry of installed resources
 * (resource-registry.dog.md). Holds manifests, evaluates availability, and routes
 * a fetch to the right resource. Provider selection is the agent's choice; the
 * registry's own default is a deterministic first-configured pick, never a
 * curated ranking.
 */
export class ResourceRegistry {
  private readonly byId = new Map<string, Resource>();
  private readonly byShape = new Map<string, Resource[]>();

  register(resource: Resource): void {
    const { id, shapes } = resource.manifest;
    if (!id) throw new Error("register: resource manifest is missing an id");
    if (this.byId.has(id)) throw new Error(`register: duplicate resource id '${id}'`);
    this.byId.set(id, resource);
    for (const shape of shapes) {
      const list = this.byShape.get(shape) ?? [];
      list.push(resource);
      this.byShape.set(shape, list);
    }
  }

  get(id: string): Resource | undefined {
    return this.byId.get(id);
  }

  availabilityOf(resource: Resource): ResourceAvailability {
    const needsConfig = (resource.manifest.configSchema?.length ?? 0) > 0;
    if (!needsConfig) return "available";
    return resource.isConfigured?.() ? "available" : "listed_but_unavailable";
  }

  /** The installed-sources overview for data_list (secrets excluded). */
  list(): SourceListing[] {
    return [...this.byId.values()].map((resource) => ({
      manifest: resource.manifest,
      availability: this.availabilityOf(resource),
    }));
  }

  /**
   * Pick the concrete resource for a fetch. With an explicit `provider`, validate
   * it exists, produces the shape, and is available. Without one, deterministically
   * pick the first *available* resource producing the shape. Failures are typed.
   */
  resolveProvider(shape: string, _entity: string, provider?: string): Resource {
    if (provider) {
      const resource = this.byId.get(provider);
      if (!resource) {
        throw new MuErrorException("UNKNOWN_SOURCE", `no resource named '${provider}'`);
      }
      if (!resource.manifest.shapes.includes(shape)) {
        throw new MuErrorException(
          "UNKNOWN_SOURCE",
          `resource '${provider}' does not produce shape '${shape}'`,
        );
      }
      if (this.availabilityOf(resource) !== "available") {
        throw new MuErrorException(
          "NOT_CONFIGURED",
          `resource '${provider}' is listed but not configured`,
        );
      }
      return resource;
    }

    const candidates = this.byShape.get(shape) ?? [];
    if (candidates.length === 0) {
      throw new MuErrorException("UNKNOWN_SOURCE", `no resource produces shape '${shape}'`);
    }
    // Skip account-scoped producers that opted out of being the unspecified default for
    // this shape (e.g. a broker's `ohlcv`/`key_stats` is about the user's portfolio, not
    // an arbitrary ticker) — they remain reachable by naming the source explicitly above.
    const eligible = candidates.filter((r) => !r.manifest.explicitOnlyShapes?.includes(shape));
    if (eligible.length === 0) {
      throw new MuErrorException(
        "UNKNOWN_SOURCE",
        `shape '${shape}' is produced only by account-scoped source(s) — name one explicitly (e.g. {source:'alpaca'})`,
      );
    }
    const available = eligible.find((r) => this.availabilityOf(r) === "available");
    if (!available) {
      throw new MuErrorException(
        "NOT_CONFIGURED",
        `resource(s) for shape '${shape}' exist but none are configured`,
      );
    }
    return available;
  }
}
