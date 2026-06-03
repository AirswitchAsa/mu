/**
 * The two extension-surface manifests, kept side by side so the resource and
 * renderer plugin contracts stay symmetric (the dogfooded plugin-host pattern).
 */

/** Resource availability, derived by `resource_availability`. */
export type ResourceAvailability = "available" | "listed_but_unavailable";

export interface ResourceParam {
  readonly name: string;
  readonly required: boolean;
  readonly description?: string;
}

/**
 * ResourceManifest — what a `#Resource` declares to register itself
 * (resource-manifest.dog.md). The source half of `data_list`. `configSchema`
 * declares *what* config exists (so `data_list` can say "needs a key"); it never
 * carries the secret value.
 */
export interface ResourceManifest {
  /** resource id; the `provider` component of every handle it produces. */
  readonly id: string;
  /** the shape id(s) this resource can supply. */
  readonly shapes: readonly string[];
  readonly params: readonly ResourceParam[];
  /** names of required config keys (e.g. `apiKey`); values stay server-side. */
  readonly configSchema?: readonly string[];
  readonly cadence?: { readonly everyMs: number };
}

export type RendererTrust = "core" | "thirdParty";

/**
 * RendererManifest — what a `#Renderer` declares to register itself
 * (renderer-manifest.dog.md). Defined here in protocol (not @mu/web) so the
 * runtime can validate agent specs and advertise types; a renderer binds to a
 * **shape, never a provider**. `specSchema` is intentionally `unknown` at this
 * layer — the web side supplies a Zod/JSON schema; protocol only fixes the slots.
 */
export interface RendererManifest {
  /** window type id this renderer serves (`price_chart`, …); unique in registry. */
  readonly type: string;
  /** schema for a window's `spec`; validated by the runtime (shape supplied frontend-side). */
  readonly specSchema: unknown;
  /** the shape id(s) the renderer binds to; the runtime checks a bound handle matches. */
  readonly requiresShape: readonly string[];
  readonly title: string;
  readonly description: string;
  readonly trust: RendererTrust;
}
