import type { Handle } from "./handle.js";

/**
 * Window — a typed view on the canvas (window.dog.md). The agent authors its
 * *content* (spec + bindings); its *position* lives in SessionState.layout, owned
 * by the user. No layout fields here, by design.
 */
export interface Window {
  readonly id: string;
  /** window/renderer type id (`price_chart`, …); must match a registered renderer. */
  readonly type: string;
  readonly title: string;
  /** renderer-validated content spec (axes, overlays, columns); never layout. */
  readonly spec: Record<string, unknown>;
  /** the handle(s) this window resolves for its data. */
  readonly bindings: readonly Handle[];
  /** ids into SessionState.provenanceLog, one per binding. */
  readonly provenanceRefs: readonly string[];
}

/** Grid placement of a window — owned by the user + auto_layout, never the agent. */
export interface Placement {
  readonly col: number;
  readonly row: number;
  readonly colSpan: number;
  readonly rowSpan: number;
  /** true once the user has moved/resized it — auto_layout then leaves it alone. */
  readonly pinned: boolean;
}

/** A partial placement carried by a move/resize op (user-only). */
export interface PlacementPatch {
  readonly col?: number;
  readonly row?: number;
  readonly colSpan?: number;
  readonly rowSpan?: number;
}
