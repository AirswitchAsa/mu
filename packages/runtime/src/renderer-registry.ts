import {
  MuErrorException,
  type RendererManifest,
  type ValidationResult,
} from "@mu/protocol";

/**
 * A registered renderer: its manifest plus an optional spec validator. `specSchema`
 * in the manifest is `unknown` at the protocol layer; the runtime works with this
 * concrete `validateSpec` (the frontend supplies a real one per renderer; the
 * server registers core renderers here).
 */
export interface RendererDef {
  readonly manifest: RendererManifest;
  validateSpec?(spec: Record<string, unknown>): ValidationResult;
}

/**
 * RendererRegistry — the capability set the runtime validates agent specs against
 * and advertises to the agent (renderer-registry / register_renderer). A renderer
 * binds to a shape, never a provider.
 */
export class RendererRegistry {
  private readonly byType = new Map<string, RendererDef>();

  register(def: RendererDef): void {
    const type = def.manifest.type;
    if (this.byType.has(type)) throw new Error(`renderer type '${type}' already registered`);
    this.byType.set(type, def);
  }

  get(type: string): RendererDef | undefined {
    return this.byType.get(type);
  }

  has(type: string): boolean {
    return this.byType.has(type);
  }

  list(): RendererManifest[] {
    return [...this.byType.values()].map((d) => d.manifest);
  }

  /** Validate an agent-authored spec for a window type; unknown type is rejected. */
  validateSpec(type: string, spec: Record<string, unknown>): void {
    const def = this.byType.get(type);
    if (!def) {
      throw new MuErrorException("VALIDATION_FAILED", `unknown window type '${type}'`);
    }
    const result = def.validateSpec?.(spec);
    if (result && !result.ok) {
      const detail = result.errors.map((e) => `${e.path || "<root>"}: ${e.message}`).join("; ");
      throw new MuErrorException("VALIDATION_FAILED", `spec for '${type}' invalid: ${detail}`);
    }
  }

  /** Whether a renderer of `type` accepts a handle of `shapeId` (empty requiresShape → any). */
  acceptsShape(type: string, shapeId: string): boolean {
    const def = this.byType.get(type);
    if (!def) return false;
    const required = def.manifest.requiresShape;
    return required.length === 0 || required.includes(shapeId);
  }
}
