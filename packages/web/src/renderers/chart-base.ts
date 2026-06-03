import { type CandlestickData, type HistogramData, type IChartApi, type LineData, createChart } from "lightweight-charts";
import type { CandleDatum, HistDatum, LineDatum } from "../lib/types";
import type { RenderTheme } from "./types";

// Our datum `time` is an epoch-SECONDS number; Lightweight Charts accepts that at
// runtime but types it as a branded `Time`. These cast at the setData boundary so
// the pure indicator lib never depends on the chart library's types.
export const candleData = (d: CandleDatum[]): CandlestickData[] => d as unknown as CandlestickData[];
export const lineData = (d: LineDatum[]): LineData[] => d as unknown as LineData[];
export const histData = (d: HistDatum[]): HistogramData[] => d as unknown as HistogramData[];

// =============================================================================
// µ — shared Lightweight Charts setup. Both chart renderers (price_chart,
// compare) create a base chart styled into the Spicadust language (hairline
// grid, mono axis labels, no attribution) and resize with their container.
// =============================================================================

export function createBaseChart(el: HTMLElement, theme: RenderTheme): IChartApi {
  const chart = createChart(el, {
    width: Math.max(1, el.clientWidth),
    height: Math.max(1, el.clientHeight),
    layout: {
      background: { color: "transparent" },
      textColor: theme.muted,
      fontFamily: theme.fontMono,
      fontSize: 11,
      attributionLogo: false,
    },
    grid: { vertLines: { visible: false }, horzLines: { color: theme.line } },
    rightPriceScale: { borderColor: theme.lineStrong, entireTextOnly: true },
    timeScale: { borderColor: theme.lineStrong, timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
    crosshair: {
      mode: 0,
      vertLine: { color: theme.inkSoft, width: 1, style: 2, labelBackgroundColor: theme.ink },
      horzLine: { color: theme.inkSoft, width: 1, style: 2, labelBackgroundColor: theme.ink },
    },
  });
  return chart;
}

/** Re-apply theme colors to an existing chart (series colors are the caller's job). */
export function applyBaseTheme(chart: IChartApi, theme: RenderTheme): void {
  chart.applyOptions({
    layout: { textColor: theme.muted, fontFamily: theme.fontMono },
    grid: { horzLines: { color: theme.line } },
    rightPriceScale: { borderColor: theme.lineStrong },
    timeScale: { borderColor: theme.lineStrong },
    crosshair: {
      vertLine: { color: theme.inkSoft, labelBackgroundColor: theme.ink },
      horzLine: { color: theme.inkSoft, labelBackgroundColor: theme.ink },
    },
  });
}

/** Keep a chart sized to its container; returns the observer to disconnect on destroy. */
export function observeResize(el: HTMLElement, chart: IChartApi): ResizeObserver {
  const ro = new ResizeObserver((entries) => {
    const cr = entries[0]?.contentRect;
    if (cr) chart.applyOptions({ width: Math.max(1, Math.floor(cr.width)), height: Math.max(1, Math.floor(cr.height)) });
  });
  ro.observe(el);
  return ro;
}

/** Cycle of accent-friendly line colors for multi-series charts. */
export function seriesColors(theme: RenderTheme): string[] {
  return [theme.action, theme.inkSoft, theme.system, theme.favorite, theme.danger];
}
