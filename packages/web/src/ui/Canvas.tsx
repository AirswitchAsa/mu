import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CanvasState, Placement } from "@mu/protocol";
import { colsForWidth, DEFAULT_SIZE_INDEX, presetForSize } from "../lib/grid";
import type { OhlcvRow } from "../lib/types";
import type { RenderTheme } from "../renderers/types";
import { ErrorBoundary } from "./ErrorBoundary";
import { GridCard } from "./GridCard";

// =============================================================================
// µ — playground canvas: a responsive grid dashboard. The column count is decided
// from the available width; each card maps onto it via the S/M/L/XL ladder and the
// board flows from the sizes (grid-auto-flow: dense). No free-floating, no pixel-
// fiddling. The user owns layout: − / + resize and drag-the-bar to reorder.
// =============================================================================

const FALLBACK: Placement = { col: 0, row: 0, ...presetForSize(DEFAULT_SIZE_INDEX), pinned: false };
const GRID_PAD = 22;
const GRID_GAP = 16;

export function Canvas(props: {
  manifest: CanvasState | null;
  data: Map<string, OhlcvRow[]>;
  dataVersion: number;
  theme: RenderTheme;
  themeKey: string;
  onSize: (id: string, sizeIndex: number) => void;
  onReorder: (dragId: string, targetId: string, after: boolean) => void;
  onReorderCommit: (dragId: string) => void;
  onClose: (id: string) => void;
}): JSX.Element {
  const { manifest, data, dataVersion, theme, themeKey, onSize, onReorder, onReorderCommit, onClose } = props;
  const gridRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(3);
  const zRef = useRef(50);
  const [zMap, setZMap] = useState<Record<string, number>>({});
  const drag = useRef<null | {
    id: string;
    card: HTMLElement;
    pointerId: number;
    start: { x: number; y: number };
    grab: DOMRect;
    moved: boolean;
  }>(null);

  // responsive column count, recomputed on width changes
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const recompute = (): void => {
      const w = el.clientWidth;
      setCols((prev) => {
        const n = colsForWidth(w, { gap: GRID_GAP, pad: GRID_PAD * 2 });
        return prev === n ? prev : n;
      });
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onFocus = useCallback((id: string): void => {
    const z = ++zRef.current;
    setZMap((prev) => (prev[id] === z ? prev : { ...prev, [id]: z }));
  }, []);

  // --- live-sort drag (ported from the design canvas) ----------------------
  const beginDrag = useCallback(
    (e: React.PointerEvent, id: string): void => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      onFocus(id);
      const card = (e.currentTarget as HTMLElement).closest(".mu-card") as HTMLElement | null;
      if (!card) return;
      card.setPointerCapture(e.pointerId);
      drag.current = {
        id,
        card,
        pointerId: e.pointerId,
        start: { x: e.clientX, y: e.clientY },
        grab: card.getBoundingClientRect(),
        moved: false,
      };
      card.classList.add("is-dragging");
      document.body.classList.add("mu-is-dragging");
    },
    [onFocus],
  );

  const moveDrag = useCallback(
    (e: React.PointerEvent): void => {
      const d = drag.current;
      if (!d) return;
      const card = d.card;
      // keep the grabbed point under the cursor even after the slot reflows
      card.style.transform = "";
      const rect = card.getBoundingClientRect();
      const dx = d.grab.left + (e.clientX - d.start.x) - rect.left;
      const dy = d.grab.top + (e.clientY - d.start.y) - rect.top;
      card.style.transform = `translate(${dx}px, ${dy}px)`;

      // find the card under the cursor (ignoring the dragged one)
      card.style.pointerEvents = "none";
      const under = document.elementFromPoint(e.clientX, e.clientY);
      card.style.pointerEvents = "";
      const tgt = under && (under as HTMLElement).closest(".mu-card");
      if (tgt && tgt !== card) {
        const tid = tgt.getAttribute("data-id");
        if (tid) {
          const tr = tgt.getBoundingClientRect();
          const after =
            e.clientY - tr.top > tr.height * 0.55 ||
            (e.clientY - tr.top > tr.height * 0.2 && e.clientX - tr.left > tr.width * 0.5);
          d.moved = true;
          onReorder(d.id, tid, after);
        }
      }
    },
    [onReorder],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent): void => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      d.card.style.transform = "";
      d.card.style.pointerEvents = "";
      d.card.classList.remove("is-dragging");
      document.body.classList.remove("mu-is-dragging");
      try {
        d.card.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
      if (d.moved) onReorderCommit(d.id); // persist the final order server-side
    },
    [onReorderCommit],
  );

  // give each newly-seen window an initial stacking value
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

  const windows = manifest?.windows ?? [];

  return (
    <div
      className="mu-grid"
      ref={gridRef}
      style={{ "--mu-cols": cols } as React.CSSProperties}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {windows.length === 0 && (
        <div className="mu-grid__empty">
          <div className="ds-loading-glyph">µ</div>
          <p className="mu-empty__hint ds-spec">ask for a chart in the conversation →</p>
        </div>
      )}
      {windows.map((w) => (
        <ErrorBoundary
          key={w.id}
          resetKey={`${w.type}:${JSON.stringify(w.spec)}:${w.bindings.join(",")}`}
          label={`card “${w.type}” failed to render`}
        >
          <GridCard
            win={w}
            placement={manifest?.layout?.[w.id] ?? FALLBACK}
            cols={cols}
            data={data}
            dataVersion={dataVersion}
            theme={theme}
            themeKey={themeKey}
            zIndex={zMap[w.id] ?? 1}
            onSize={onSize}
            onClose={onClose}
            onFocus={onFocus}
            beginDrag={beginDrag}
          />
        </ErrorBoundary>
      ))}
    </div>
  );
}
