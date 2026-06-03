import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CanvasState, Placement } from "@mu/protocol";
import type { OhlcvRow } from "../lib/types";
import type { RenderTheme } from "../renderers/types";
import { ErrorBoundary } from "./ErrorBoundary";
import { WindowFrame } from "./WindowFrame";

// =============================================================================
// µ — playground canvas. A dot-grid surface; windows are placed on a 12-column
// grid (the backend's layout model) rendered to pixels. Free-feeling drag/resize
// snaps back to the grid on drop and emits user move/resize ops.
// =============================================================================

const COLS = 12;
const ROW_H = 84;
const FALLBACK: Placement = { col: 0, row: 0, colSpan: 8, rowSpan: 4, pinned: false };

export function Canvas(props: {
  manifest: CanvasState | null;
  data: Map<string, OhlcvRow[]>;
  dataVersion: number;
  theme: RenderTheme;
  themeKey: string;
  onMove: (id: string, patch: { col: number; row: number }) => void;
  onResize: (id: string, patch: { colSpan: number; rowSpan: number }) => void;
  onClose: (id: string) => void;
}): JSX.Element {
  const { manifest, data, dataVersion, theme, themeKey, onMove, onResize, onClose } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  const zRef = useRef(50);
  const [zMap, setZMap] = useState<Record<string, number>>({});

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = (): void => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onFocus = (id: string): void => {
    const z = ++zRef.current;
    setZMap((prev) => (prev[id] === z ? prev : { ...prev, [id]: z }));
  };

  // give the most-recently-created window a sensible initial stacking bump
  useEffect(() => {
    if (!manifest) return;
    setZMap((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const w of manifest.windows) {
        if (next[w.id] === undefined) {
          next[w.id] = ++zRef.current;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [manifest]);

  const colWidth = width / COLS;
  const windows = manifest?.windows ?? [];

  return (
    <div className="mu-canvas" ref={scrollRef}>
      {windows.length === 0 && (
        <div className="mu-canvas__empty">
          <div className="ds-loading-glyph">µ</div>
          <p className="mu-empty__hint ds-spec">ask for a chart in the conversation →</p>
        </div>
      )}
      {windows.map((w) => (
        <ErrorBoundary key={w.id} resetKey={`${w.type}:${JSON.stringify(w.spec)}:${w.bindings.join(",")}`} label={`window “${w.type}” failed to render`}>
          <WindowFrame
            win={w}
            placement={manifest?.layout?.[w.id] ?? FALLBACK}
            grid={{ cols: COLS, colWidth, rowH: ROW_H }}
            data={data}
            dataVersion={dataVersion}
            theme={theme}
            themeKey={themeKey}
            zIndex={zMap[w.id] ?? 1}
            onMove={onMove}
            onResize={onResize}
            onClose={onClose}
            onFocus={onFocus}
          />
        </ErrorBoundary>
      ))}
    </div>
  );
}
