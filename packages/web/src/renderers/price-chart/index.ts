import { CandlestickSeries, HistogramSeries, LineSeries, type ISeriesApi } from "lightweight-charts";
import { ema, sma, toCandles, toVolume } from "../../lib/indicators";
import { overlaysOf, showVolume } from "../../lib/specs";
import { applyBaseTheme, candleData, createBaseChart, histData, lineData, observeResize } from "../chart-base";
import type { RenderContext, RendererInstance, RendererPlugin } from "../types";

// =============================================================================
// price_chart — OHLCV candlesticks for one instrument, with baked indicators the
// agent toggles via spec (overlays: sma/ema; volume). Binds the first handle.
// =============================================================================

const overlayColor = (kind: "sma" | "ema", theme: RenderContext["theme"]): string =>
  kind === "sma" ? theme.action : theme.favorite;

const plugin: RendererPlugin = {
  type: "price_chart",
  mount(el, ctx) {
    const chart = createBaseChart(el, ctx.theme);
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: ctx.theme.system,
      downColor: ctx.theme.danger,
      wickUpColor: ctx.theme.system,
      wickDownColor: ctx.theme.danger,
      borderVisible: false,
    });
    const overlays = new Map<string, ISeriesApi<"Line">>();
    let volume: ISeriesApi<"Histogram"> | null = null;
    const ro = observeResize(el, chart);
    let last: RenderContext = ctx;

    const rowsOf = (c: RenderContext) => c.data.get(c.handles[0] ?? "") ?? [];

    function render(c: RenderContext): void {
      last = c;
      const rows = rowsOf(c);
      candle.setData(candleData(toCandles(rows)));
      candle.applyOptions({
        upColor: c.theme.system,
        downColor: c.theme.danger,
        wickUpColor: c.theme.system,
        wickDownColor: c.theme.danger,
      });

      // reconcile overlays against the spec (keyed sma:50 / ema:12)
      const desired = overlaysOf(c.spec);
      const wanted = new Set(desired.map((o) => `${o.kind}:${o.period}`));
      for (const [key, series] of overlays) {
        if (!wanted.has(key)) {
          chart.removeSeries(series);
          overlays.delete(key);
        }
      }
      for (const o of desired) {
        const key = `${o.kind}:${o.period}`;
        let series = overlays.get(key);
        if (!series) {
          series = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
          overlays.set(key, series);
        }
        series.applyOptions({ color: overlayColor(o.kind, c.theme) });
        series.setData(lineData(o.kind === "sma" ? sma(rows, o.period) : ema(rows, o.period)));
      }

      // volume pane (bottom 22%) — toggled by spec
      if (showVolume(c.spec) && rows.length) {
        if (!volume) {
          volume = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false });
          chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
        }
        volume.setData(histData(toVolume(rows, c.theme.system, c.theme.danger)));
      } else if (volume) {
        chart.removeSeries(volume);
        volume = null;
      }

      chart.timeScale().fitContent();
    }

    render(ctx);

    return {
      update: render,
      retheme(theme) {
        applyBaseTheme(chart, theme);
        render({ ...last, theme });
      },
      destroy() {
        ro.disconnect();
        chart.remove();
      },
    } satisfies RendererInstance;
  },
};

export default plugin;
