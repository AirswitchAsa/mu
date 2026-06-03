import type { CanvasState, CanvasSummary, SessionState } from "@mu/protocol";

/** The cheap projection that rides along every agent turn (inject_canvas_state). */
export function buildCanvasSummary(state: SessionState): CanvasSummary {
  return {
    windows: state.windows.map((w) => ({
      id: w.id,
      type: w.type,
      title: w.title,
      handles: w.bindings,
    })),
    focusedWindowId: state.focusedWindowId,
    windowCount: state.windows.length,
  };
}

/** The full canvas detail for get_canvas_state (no dataset payloads). */
export function buildCanvasState(state: SessionState): CanvasState {
  return {
    id: state.id,
    windows: state.windows,
    layout: state.layout,
    focusedWindowId: state.focusedWindowId,
  };
}
