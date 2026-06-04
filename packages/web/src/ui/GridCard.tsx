import { useEffect, useRef } from "react";
import type { Placement, Window } from "@mu/protocol";
import { lastClose, pctChange } from "../lib/indicators";
import { presetForSize, SIZE_LABELS, sizeIndexOf, MAX_SIZE } from "../lib/grid";
import { mergeNews } from "../lib/cards";
import { compareBase, symbolOf } from "../lib/specs";
import type { DataMap, KeyStatsRow, NewsRow, OhlcvRow, ReleaseRow } from "../lib/types";
import { getRenderer } from "../renderers/registry";
import type { RenderContext, RendererInstance, RenderTheme } from "../renderers/types";
import { NewsCard } from "./cards/News";
import { ReleasesCard } from "./cards/Releases";
import { KeyStatsCard } from "./cards/KeyStats";

// =============================================================================
// µ — a grid card: a drag-handle bar (grip · title · handle · sizer · close) over
// a renderer-mounted body. The agent owns content (type/spec/bindings); the user
// owns layout — drag the bar to reorder, − / + to step the S/M/L/XL size. The card
// occupies grid cells; the board flows from each card's size (no free-floating).
// =============================================================================

function WinLegend({ win, data }: { win: Window; data: DataMap }): JSX.Element | null {
  if (win.type === "price_chart" && win.bindings[0]) {
    const rows = (data.get(win.bindings[0]) ?? []) as unknown as OhlcvRow[];
    const chg = pctChange(rows);
    const up = chg >= 0;
    return (
      <div className="mu-legend">
        <span className="mu-legend__sym">{symbolOf(win.bindings[0])}</span>
        <span className="mu-legend__price">{rows.length ? lastClose(rows).toFixed(2) : "—"}</span>
        <span className="mu-legend__chg" data-dir={up ? "up" : "down"}>
          {up ? "+" : ""}
          {chg.toFixed(1)}%
        </span>
        {/* per-indicator legend (swatch · label · last value) is drawn by the
            renderer itself, where the series colors live — see price-chart. */}
      </div>
    );
  }
  if (win.type === "compare" && win.bindings.length) {
    return (
      <div className="mu-legend">
        {win.bindings.map((h, i) => {
          const chg = pctChange((data.get(h) ?? []) as unknown as OhlcvRow[]);
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

/** Mounts an imperative renderer plugin (charts/memo) and reconciles it on change. */
function RendererMount(props: {
  win: Window;
  data: DataMap;
  dataVersion: number;
  theme: RenderTheme;
}): JSX.Element {
  const { win, data, dataVersion, theme } = props;
  const bodyRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<RendererInstance | null>(null);

  const ctx = (): RenderContext => ({
    spec: win.spec,
    handles: [...win.bindings],
    // charts consume ohlcv rows; the shared cache is untyped, cast at the boundary.
    data: new Map(win.bindings.map((h) => [h, (data.get(h) ?? []) as unknown as OhlcvRow[]])),
    theme,
  });

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

  useEffect(() => {
    instRef.current?.update(ctx());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.spec, win.bindings, dataVersion]);

  // Key on the `theme` object itself, not a `themeKey` string: the key flips a
  // render BEFORE the theme colors are read from CSS vars (App updates `theme` in
  // a layout effect), so keying on the string fires retheme with a stale theme
  // and never re-fires — leaving the chart one toggle behind. `theme`'s identity
  // changes exactly when the colors change, carrying the fresh value.
  useEffect(() => {
    instRef.current?.retheme(theme);
  }, [theme]);

  return <div className="mu-chart" ref={bodyRef} />;
}

function CardBody(props: {
  win: Window;
  data: DataMap;
  dataVersion: number;
  theme: RenderTheme;
  themeKey: string;
}): JSX.Element {
  const { win, data } = props;
  if (win.type === "news") {
    const items = mergeNews(win.bindings.map((h) => (data.get(h) ?? []) as unknown as NewsRow[]));
    return <NewsCard items={items} now={Date.now()} />;
  }
  if (win.type === "releases") {
    const rows = win.bindings.flatMap((h) => (data.get(h) ?? []) as unknown as ReleaseRow[]);
    return <ReleasesCard rows={rows} now={Date.now()} />;
  }
  if (win.type === "key_stats") {
    const rows = win.bindings.flatMap((h) => (data.get(h) ?? []) as unknown as KeyStatsRow[]);
    return <KeyStatsCard rows={rows} now={Date.now()} />;
  }
  const isChart = win.type === "price_chart" || win.type === "compare";
  return (
    <>
      {isChart && <WinLegend win={win} data={props.data} />}
      <div className="mu-card__chart">
        {getRenderer(win.type) ? (
          <RendererMount {...props} />
        ) : (
          <div className="mu-card__fallback">no renderer for “{win.type}”</div>
        )}
      </div>
    </>
  );
}

export function GridCard(props: {
  win: Window;
  placement: Placement;
  cols: number;
  data: DataMap;
  dataVersion: number;
  theme: RenderTheme;
  themeKey: string;
  zIndex: number;
  onSize: (id: string, sizeIndex: number) => void;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  beginDrag: (e: React.PointerEvent, id: string) => void;
}): JSX.Element {
  const { win, placement, cols, zIndex, onSize, onClose, onFocus, beginDrag } = props;
  const size = sizeIndexOf(placement);
  const preset = presetForSize(size);
  const span = Math.min(preset.colSpan, cols);
  const atMin = size <= 0;
  const atMax = size >= MAX_SIZE;

  const step = (dir: number): void => {
    const next = Math.max(0, Math.min(MAX_SIZE, size + dir));
    if (next !== size) onSize(win.id, next);
  };

  const onKey = (e: React.KeyboardEvent): void => {
    if ((e.target as HTMLElement).closest("input, textarea")) return;
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      step(1);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      step(-1);
    } else if ((e.key === "Delete" || e.key === "Backspace") && e.shiftKey) {
      e.preventDefault();
      onClose(win.id);
    }
  };

  const handle = win.bindings[0] ?? "";

  return (
    <article
      className="mu-card"
      data-id={win.id}
      data-type={win.type}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerDown={() => onFocus(win.id)}
      style={{ gridColumn: `span ${span}`, gridRow: `span ${preset.rowSpan}`, zIndex }}
    >
      <header className="mu-card__bar" onPointerDown={(e) => beginDrag(e, win.id)}>
        <span className="mu-card__grip" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M8 7h.01M8 12h.01M8 17h.01M16 7h.01M16 12h.01M16 17h.01" />
          </svg>
        </span>
        <span className="mu-card__title">{win.title}</span>
        {handle && (
          <span className="mu-card__handle ds-spec" title={handle}>
            {handle}
          </span>
        )}
        <div className="mu-card__tools">
          <div className="mu-sizer" role="group" aria-label="resize">
            <button className="mu-sizer__btn" onClick={() => step(-1)} disabled={atMin} aria-label="smaller" title="smaller">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 12h14" />
              </svg>
            </button>
            <span className="mu-sizer__val ds-spec">{SIZE_LABELS[size]}</span>
            <button className="mu-sizer__btn" onClick={() => step(1)} disabled={atMax} aria-label="larger" title="larger">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
          <button className="mu-card__close" onClick={() => onClose(win.id)} aria-label="close" title="close">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>
      <div className="mu-card__body">
        <CardBody win={win} data={props.data} dataVersion={props.dataVersion} theme={props.theme} themeKey={props.themeKey} />
      </div>
    </article>
  );
}
