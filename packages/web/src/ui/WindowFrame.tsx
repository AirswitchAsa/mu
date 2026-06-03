import { useEffect, useRef } from "react";
import type { Placement, Window } from "@mu/protocol";
import { lastClose, pctChange } from "../lib/indicators";
import { compareBase, overlaysOf, symbolOf } from "../lib/specs";
import type { OhlcvRow } from "../lib/types";
import { getRenderer } from "../renderers/registry";
import type { RenderContext, RendererInstance, RenderTheme } from "../renderers/types";

// =============================================================================
// µ — a window: title bar (centered lowercase title, handle on hover, close),
// legend strip, and a renderer-mounted body. The agent owns content; the user
// owns layout — drag the bar / pull the grip to emit grid move/resize ops.
// =============================================================================

const GAP = 16;

interface GridInfo {
  cols: number;
  colWidth: number;
  rowH: number;
}

function WinLegend({ win, data }: { win: Window; data: Map<string, OhlcvRow[]> }): JSX.Element | null {
  if (win.type === "price_chart" && win.bindings[0]) {
    const rows = data.get(win.bindings[0]) ?? [];
    const sym = symbolOf(win.bindings[0]);
    const chg = pctChange(rows);
    const up = chg >= 0;
    const overlays = overlaysOf(win.spec);
    return (
      <div className="mu-legend">
        <span className="mu-legend__sym">{sym}</span>
        <span className="mu-legend__price">{rows.length ? lastClose(rows).toFixed(2) : "—"}</span>
        <span className="mu-legend__chg" data-dir={up ? "up" : "down"}>
          {up ? "+" : ""}
          {chg.toFixed(1)}%
        </span>
        {overlays.map((o) => (
          <span className="mu-legend__tag" key={`${o.kind}:${o.period}`}>
            {o.kind} {o.period}
          </span>
        ))}
      </div>
    );
  }
  if (win.type === "compare" && win.bindings.length) {
    return (
      <div className="mu-legend">
        {win.bindings.map((h, i) => {
          const rows = data.get(h) ?? [];
          const chg = pctChange(rows);
          return (
            <span className="mu-legend__key" data-series={i === 0 ? "a" : "b"} key={h}>
              {symbolOf(h)} {chg >= 0 ? "+" : ""}
              {chg.toFixed(1)}%
            </span>
          );
        })}
        <span className="mu-legend__tag">indexed · base {compareBase(win.spec)}</span>
      </div>
    );
  }
  return null;
}

export function WindowFrame(props: {
  win: Window;
  placement: Placement;
  grid: GridInfo;
  data: Map<string, OhlcvRow[]>;
  dataVersion: number;
  theme: RenderTheme;
  themeKey: string;
  zIndex: number;
  onMove: (id: string, patch: { col: number; row: number }) => void;
  onResize: (id: string, patch: { colSpan: number; rowSpan: number }) => void;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
}): JSX.Element {
  const { win, placement, grid, data, dataVersion, theme, themeKey, zIndex, onMove, onResize, onClose, onFocus } = props;
  const frameRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<RendererInstance | null>(null);
  const drag = useRef<null | { mode: "move" | "resize"; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number }>(null);

  const left = placement.col * grid.colWidth + GAP / 2;
  const top = placement.row * grid.rowH + GAP / 2;
  const width = placement.colSpan * grid.colWidth - GAP;
  const height = placement.rowSpan * grid.rowH - GAP;

  // build the renderer context from this window's bindings
  const ctx = (): RenderContext => ({
    spec: win.spec,
    handles: [...win.bindings],
    data: new Map(win.bindings.map((h) => [h, data.get(h) ?? []])),
    theme,
  });

  // mount the renderer plugin (once per window type)
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const plugin = getRenderer(win.type);
    if (!plugin) return;
    const inst = plugin.mount(el, ctx());
    instRef.current = inst;
    return () => {
      inst.destroy();
      instRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.type]);

  // re-render on spec / bindings / data change (the reconcile patch)
  useEffect(() => {
    instRef.current?.update(ctx());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.spec, win.bindings, dataVersion]);

  // recolor on theme / accent flip
  useEffect(() => {
    instRef.current?.retheme(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey]);

  const startDrag = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest(".mu-win__close")) return;
    e.preventDefault();
    onFocus(win.id);
    const el = frameRef.current!;
    drag.current = { mode: "move", sx: e.clientX, sy: e.clientY, ox: el.offsetLeft, oy: el.offsetTop, ow: el.offsetWidth, oh: el.offsetHeight };
    el.setPointerCapture(e.pointerId);
    el.classList.add("is-dragging");
  };

  const startResize = (e: React.PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    onFocus(win.id);
    const el = frameRef.current!;
    drag.current = { mode: "resize", sx: e.clientX, sy: e.clientY, ox: el.offsetLeft, oy: el.offsetTop, ow: el.offsetWidth, oh: el.offsetHeight };
    el.setPointerCapture(e.pointerId);
    el.classList.add("is-dragging");
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const el = frameRef.current!;
    if (d.mode === "move") {
      el.style.left = `${Math.max(0, d.ox + (e.clientX - d.sx))}px`;
      el.style.top = `${Math.max(0, d.oy + (e.clientY - d.sy))}px`;
    } else {
      el.style.width = `${Math.max(grid.colWidth - GAP, d.ow + (e.clientX - d.sx))}px`;
      el.style.height = `${Math.max(grid.rowH - GAP, d.oh + (e.clientY - d.sy))}px`;
    }
  };

  const endDrag = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const el = frameRef.current!;
    el.classList.remove("is-dragging");
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
    if (d.mode === "move") {
      const col = clamp(Math.round(el.offsetLeft / grid.colWidth), 0, grid.cols - placement.colSpan);
      const row = Math.max(0, Math.round(el.offsetTop / grid.rowH));
      onMove(win.id, { col, row });
    } else {
      const colSpan = clamp(Math.round(el.offsetWidth / grid.colWidth), 1, grid.cols - placement.col);
      const rowSpan = Math.max(1, Math.round(el.offsetHeight / grid.rowH));
      onResize(win.id, { colSpan, rowSpan });
    }
  };

  const handle = win.bindings[0] ?? "";

  return (
    <div
      ref={frameRef}
      className="mu-win"
      style={{ left, top, width, height, zIndex }}
      onPointerDown={() => onFocus(win.id)}
    >
      <div className="mu-win__bar" onPointerDown={startDrag} onPointerMove={onPointerMove} onPointerUp={endDrag}>
        {handle && (
          <span className="mu-win__handle ds-spec" title={handle}>
            {handle}
          </span>
        )}
        <span className="mu-win__title">{win.title}</span>
        <button className="mu-win__close" title="close" onClick={() => onClose(win.id)} aria-label="close">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <WinLegend win={win} data={data} />
      <div className="mu-win__body">
        {getRenderer(win.type) ? (
          <div className="mu-chart" ref={bodyRef} />
        ) : (
          <div className="mu-win__fallback">no renderer for “{win.type}”</div>
        )}
      </div>
      <div className="mu-win__resize" onPointerDown={startResize} onPointerMove={onPointerMove} onPointerUp={endDrag} title="resize" />
    </div>
  );
}
