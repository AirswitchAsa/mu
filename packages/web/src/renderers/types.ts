import type { OhlcvRow } from "../lib/types";

// =============================================================================
// µ — client renderer plugin contract (the "playground component" interface)
// Renderers are loaded like resources (glob a folder → register by `type`). The
// server manifest is authoritative for which types/specs are valid; a plugin
// supplies the *draw code*. A plugin consumes (spec + resolved data + theme) and
// owns an imperative instance it mutates as the manifest reconciles.
// =============================================================================

/** Theme colors, read once from the design-system CSS vars and handed to plugins. */
export interface RenderTheme {
  paper: string;
  ink: string;
  inkSoft: string;
  muted: string;
  line: string;
  lineStrong: string;
  action: string;
  system: string;
  danger: string;
  favorite: string;
  fontMono: string;
}

/** What a renderer is handed on mount and every update. */
export interface RenderContext {
  /** the window's agent-authored content spec. */
  spec: Record<string, unknown>;
  /** bound handles, in order. */
  handles: string[];
  /** handle → resolved rows (server-side full data). */
  data: Map<string, OhlcvRow[]>;
  theme: RenderTheme;
}

/** A live renderer mounted in a window body. */
export interface RendererInstance {
  /** re-render for a new spec / data (manifest reconcile). */
  update(ctx: RenderContext): void;
  /** recolor for a theme/accent flip (no data change). */
  retheme(theme: RenderTheme): void;
  destroy(): void;
}

/** A registered playground component. */
export interface RendererPlugin {
  readonly type: string;
  mount(el: HTMLElement, ctx: RenderContext): RendererInstance;
}
