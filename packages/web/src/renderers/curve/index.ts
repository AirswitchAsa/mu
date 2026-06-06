import { curveSeries, latestSnapshot, type CurveSeriesOut, type CurveSpec } from "../../lib/options";
import type { RenderContext, RendererInstance, RendererPlugin, RenderTheme } from "../types";

// =============================================================================
// `curve` — a generic xy line chart over a NON-time numeric axis (so not Lightweight
// Charts). It folds a cross-section into series via lib/options `curveSeries` (pure):
// projection (x,y,series,where) draws an IV smile/skew; reduce (groupBy+pick) draws a
// term structure. This file is just the SVG: axes, gridlines, one polyline per series,
// a legend, and a hover readout. Binds the first handle.
// =============================================================================

const SVGNS = "http://www.w3.org/2000/svg";
const M = { top: 12, right: 14, bottom: 30, left: 52 };

const svg = (tag: string, attrs: Record<string, string | number> = {}): SVGElement => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const div = (cls: string): HTMLElement => {
  const e = document.createElement("div");
  e.className = cls;
  return e;
};

const str = (spec: Record<string, unknown>, k: string): string | undefined =>
  typeof spec[k] === "string" ? (spec[k] as string) : undefined;

/** Format a y value: vols (|v|<3) read cleaner as a percentage; pass yFormat:"num" to force raw. */
function fmtY(v: number, mode: "pct" | "num" | "auto"): string {
  if (!Number.isFinite(v)) return "";
  if (mode === "pct") return `${(v * 100).toFixed(1)}%`;
  if (mode === "num") return v.toFixed(2);
  return Math.abs(v) < 3 ? `${(v * 100).toFixed(1)}%` : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
const fmtX = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2));

function ticks(lo: number, hi: number, n: number): number[] {
  if (!(hi > lo)) return [lo];
  const step = (hi - lo) / n;
  return Array.from({ length: n + 1 }, (_, i) => lo + i * step);
}

const plugin: RendererPlugin = {
  type: "curve",
  mount(host, ctx) {
    const root = div("mu-curve");
    host.appendChild(root);
    const legend = div("mu-curve__legend");
    const tip = div("mu-curve__tip");
    tip.style.display = "none";
    const svgEl = svg("svg", { class: "mu-curve__svg" }) as SVGSVGElement;
    root.append(svgEl, legend, tip);

    let last: RenderContext = ctx;
    const ro = new ResizeObserver(() => draw(last));
    ro.observe(root);

    function draw(c: RenderContext): void {
      last = c;
      const w = root.clientWidth || 320;
      const h = root.clientHeight || 200;
      svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svgEl.replaceChildren();
      const t = c.theme;

      let rows = (c.data.get(c.handles[0] ?? "") ?? []) as unknown as Record<string, unknown>[];
      if (rows.length && typeof rows[0]!["as_of"] === "number") rows = latestSnapshot(rows as { as_of: number }[]) as Record<string, unknown>[];
      const series = curveSeries(rows, c.spec as CurveSpec).filter((s) => s.points.length > 0);

      if (series.length === 0) {
        const note = svg("text", { x: w / 2, y: h / 2, "text-anchor": "middle", fill: t.muted, "font-family": t.fontMono, "font-size": 12 });
        note.textContent = "no curve data — bind an orats:options_chain handle";
        svgEl.appendChild(note);
        legend.replaceChildren();
        return;
      }

      // domains across all series
      let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
      for (const s of series)
        for (const p of s.points) {
          if (p.x < xmin) xmin = p.x;
          if (p.x > xmax) xmax = p.x;
          if (p.y < ymin) ymin = p.y;
          if (p.y > ymax) ymax = p.y;
        }
      const ypad = (ymax - ymin || 1) * 0.08;
      ymin -= ypad;
      ymax += ypad;
      const plotW = Math.max(1, w - M.left - M.right);
      const plotH = Math.max(1, h - M.top - M.bottom);
      const sx = (x: number): number => M.left + (xmax > xmin ? (x - xmin) / (xmax - xmin) : 0.5) * plotW;
      const sy = (y: number): number => M.top + (ymax > ymin ? 1 - (y - ymin) / (ymax - ymin) : 0.5) * plotH;
      const yMode = (str(c.spec, "yFormat") as "pct" | "num" | undefined) ?? "auto";

      // gridlines + axis labels
      for (const gy of ticks(ymin, ymax, 4)) {
        const py = sy(gy);
        svgEl.appendChild(svg("line", { x1: M.left, y1: py, x2: w - M.right, y2: py, stroke: t.line, "stroke-width": 1 }));
        const lab = svg("text", { x: M.left - 8, y: py + 3, "text-anchor": "end", fill: t.muted, "font-family": t.fontMono, "font-size": 10 });
        lab.textContent = fmtY(gy, yMode);
        svgEl.appendChild(lab);
      }
      for (const gx of ticks(xmin, xmax, 5)) {
        const px = sx(gx);
        const lab = svg("text", { x: px, y: h - M.bottom + 16, "text-anchor": "middle", fill: t.muted, "font-family": t.fontMono, "font-size": 10 });
        lab.textContent = fmtX(gx);
        svgEl.appendChild(lab);
      }
      // axis titles
      const xTitle = str(c.spec, "xLabel") ?? (typeof c.spec["x"] === "string" ? (c.spec["x"] as string) : "");
      if (xTitle) {
        const xt = svg("text", { x: M.left + plotW / 2, y: h - 4, "text-anchor": "middle", fill: t.inkSoft, "font-family": t.fontMono, "font-size": 10 });
        xt.textContent = xTitle;
        svgEl.appendChild(xt);
      }

      const palette = [t.action, t.favorite, t.system, t.danger, t.inkSoft];
      series.forEach((s, i) => {
        const color = palette[i % palette.length]!;
        const d = s.points.map((p, j) => `${j === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
        svgEl.appendChild(svg("path", { d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round" }));
        for (const p of s.points) svgEl.appendChild(svg("circle", { cx: sx(p.x), cy: sy(p.y), r: 2, fill: color }));
      });

      buildLegend(series, palette);
      attachHover(c, series, { sx, sy, xmin, xmax, w, h, yMode });
    }

    function buildLegend(series: CurveSeriesOut[], palette: string[]): void {
      legend.replaceChildren();
      series.forEach((s, i) => {
        const row = div("mu-curve__legend-row");
        const dot = div("mu-curve__legend-dot");
        dot.style.background = palette[i % palette.length]!;
        const lab = div("mu-curve__legend-label");
        lab.textContent = s.label;
        row.append(dot, lab);
        legend.appendChild(row);
      });
    }

    function attachHover(
      c: RenderContext,
      series: CurveSeriesOut[],
      g: { sx: (x: number) => number; sy: (y: number) => number; xmin: number; xmax: number; w: number; h: number; yMode: "pct" | "num" | "auto" },
    ): void {
      const guide = svg("line", { stroke: c.theme.lineStrong, "stroke-width": 1, "stroke-dasharray": "3 3", y1: M.top, y2: g.h - M.bottom });
      guide.setAttribute("visibility", "hidden");
      svgEl.appendChild(guide);
      const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
      svgEl.onmousemove = (ev: MouseEvent) => {
        const rect = svgEl.getBoundingClientRect();
        const mx = ev.clientX - rect.left;
        if (xs.length === 0) return;
        const xv = g.xmin + (g.xmax - g.xmin) * Math.max(0, Math.min(1, (mx - M.left) / Math.max(1, g.w - M.left - M.right)));
        let nx = xs[0]!;
        for (const x of xs) if (Math.abs(x - xv) < Math.abs(nx - xv)) nx = x;
        guide.setAttribute("x1", String(g.sx(nx)));
        guide.setAttribute("x2", String(g.sx(nx)));
        guide.setAttribute("visibility", "visible");
        const parts = series
          .map((s) => {
            const pt = s.points.find((p) => p.x === nx);
            return pt ? `${s.label} ${fmtY(pt.y, g.yMode)}` : "";
          })
          .filter(Boolean);
        tip.textContent = `${fmtX(nx)}   ${parts.join("   ")}`;
        tip.style.display = "block";
        tip.style.left = `${Math.min(g.w - 8, mx + 12)}px`;
      };
      svgEl.onmouseleave = () => {
        guide.setAttribute("visibility", "hidden");
        tip.style.display = "none";
      };
    }

    draw(ctx);

    return {
      update: draw,
      retheme(theme: RenderTheme) {
        draw({ ...last, theme });
      },
      destroy() {
        ro.disconnect();
        root.remove();
      },
    } satisfies RendererInstance;
  },
};

export default plugin;
