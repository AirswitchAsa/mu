import type { Handle } from "./handle.js";

/** One compact line per window — ids/types/titles/handles only, never specs. */
export interface CanvasSummaryWindow {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly handles: readonly Handle[];
}

/**
 * CanvasSummary — the cheap projection of SessionState that rides along every
 * agent turn (canvas-summary.dog.md). Flat per-turn cost regardless of canvas size;
 * the agent fetches full detail via get_canvas_state when it needs specifics.
 */
export interface CanvasSummary {
  readonly windows: readonly CanvasSummaryWindow[];
  readonly focusedWindowId?: string;
  readonly windowCount: number;
}
