import { CandlestickSeries, HistogramSeries, LineSeries, type IPriceLine, type ISeriesApi } from "lightweight-charts";
import { toCandles } from "../../lib/indicators";
import { getIndicatorOutputs, lastValueOf, type IndHistPoint, type IndicatorOutput } from "../../lib/indicator-compute";
import { indicatorsOf, type ActiveIndicator } from "../../lib/specs";
import type { LineDatum, HistDatum } from "../../lib/types";
import { applyBaseTheme, candleData, createBaseChart, histData, lineData, observeResize, seriesColors } from "../chart-base";
import type { RenderContext, RendererInstance, RendererPlugin, RenderTheme } from "../types";

// =============================================================================
// price_chart — OHLCV candlesticks for one instrument, plus catalog indicators
// the agent toggles via spec.indicators (see @mu/protocol INDICATORS). The
// renderer is GENERIC over indicators: it reads each one's outputs from the pure
// compute lib and draws them by placement — "price" outputs on the candle axis,
// "pane" outputs in their own axed sub-pane (so volume/RSI/MACD/… each get a real
// y-axis). An imperative legend overlays the active indicators (swatch · label ·
// last value). Adding an indicator needs no change here. Binds the first handle.
// =============================================================================

type AnySeries = ISeriesApi<"Line"> | ISeriesApi<"Histogram">;

const seriesKey = (ind: ActiveIndicator, out: IndicatorOutput): string => `${ind.key}|${out.key}`;

const plugin: RendererPlugin = {
  type: "price_chart",
  mount(el, ctx) {
    const chart = createBaseChart(el, ctx.theme);
    const candle = chart.addSeries(CandlestickSeries, candleColors(ctx.theme), 0);

    const priceSeries = new Map<string, AnySeries>(); // overlays on pane 0
    const paneSeries = new Map<string, AnySeries>(); // own-pane indicators
    let guides: IPriceLine[] = [];
    let lastPriceSig = "";
    let lastPaneSig = "";

    const ro = observeResize(el, chart);
    let last: RenderContext = ctx;

    // imperative indicator legend (color swatches + last values), overlaid top-left.
    const legendEl = document.createElement("div");
    legendEl.className = "mu-ind-legend";
    el.appendChild(legendEl);

    const rowsOf = (c: RenderContext) => c.data.get(c.handles[0] ?? "") ?? [];

    function makeSeries(out: IndicatorOutput, paneIndex: number, scale?: { min: number; max: number }): AnySeries {
      if (out.kind === "histogram") {
        return chart.addSeries(
          HistogramSeries,
          { priceFormat: out.role === "volume" ? { type: "volume" } : { type: "price", precision: 2, minMove: 0.01 }, priceLineVisible: false, lastValueVisible: false },
          paneIndex,
        );
      }
      return chart.addSeries(
        LineSeries,
        {
          lineWidth: out.role === "band" ? 1 : 2,
          lineStyle: out.role === "band" ? 2 : 0,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          ...(scale ? { autoscaleInfoProvider: () => ({ priceRange: { minValue: scale.min, maxValue: scale.max } }) } : {}),
        },
        paneIndex,
      );
    }

    function fill(series: AnySeries, out: IndicatorOutput, theme: RenderTheme, color: string): void {
      if (out.kind === "histogram") {
        const up = theme.system;
        const dn = theme.danger;
        const data = (out.data as readonly IndHistPoint[]).map((d) => ({ time: d.time, value: d.value, color: d.dir >= 0 ? up : dn }));
        (series as ISeriesApi<"Histogram">).setData(histData(data as unknown as HistDatum[]));
      } else {
        (series as ISeriesApi<"Line">).applyOptions({ color });
        (series as ISeriesApi<"Line">).setData(lineData(out.data as unknown as LineDatum[]));
      }
    }

    function render(c: RenderContext): void {
      last = c;
      const rows = rowsOf(c);
      const palette = seriesColors(c.theme);
      candle.setData(candleData(toCandles(rows)));
      candle.applyOptions(candleColors(c.theme));

      const inds = indicatorsOf(c.spec);
      const price = inds.filter((i) => i.def.placement === "price");
      const pane = inds.filter((i) => i.def.placement === "pane");

      // compute each indicator's outputs once, keyed for reuse below.
      const outs = new Map<string, IndicatorOutput[]>();
      for (const ind of inds) outs.set(ind.key, getIndicatorOutputs(ind.name, rows, ind.params));

      const colorFor = (role: IndicatorOutput["role"], base: string): string => {
        switch (role) {
          case "secondary":
            return c.theme.favorite;
          case "band":
            return c.theme.muted;
          case "up":
            return c.theme.system;
          case "down":
            return c.theme.danger;
          default:
            return base; // primary / dots / signed
        }
      };

      // --- price overlays (pane 0): rebuild the series set when it changes ---
      const priceSig = price.map((i) => i.key).join("|");
      if (priceSig !== lastPriceSig) {
        for (const s of priceSeries.values()) chart.removeSeries(s);
        priceSeries.clear();
        price.forEach((ind) => {
          for (const out of outs.get(ind.key) ?? []) priceSeries.set(seriesKey(ind, out), makeSeries(out, 0));
        });
        lastPriceSig = priceSig;
      }
      price.forEach((ind, idx) => {
        const base = palette[idx % palette.length]!;
        for (const out of outs.get(ind.key) ?? []) {
          const s = priceSeries.get(seriesKey(ind, out));
          if (s) fill(s, out, c.theme, colorFor(out.role, base));
        }
      });

      // --- pane indicators: own pane (own axis) per indicator ---
      const paneSig = pane.map((i) => i.key).join("|");
      if (paneSig !== lastPaneSig) {
        // price lines die with their series, so removing the series clears the
        // guides too — just drop the tracking list.
        guides = [];
        for (const s of paneSeries.values()) chart.removeSeries(s);
        paneSeries.clear();
        while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);
        pane.forEach((ind, idx) => {
          const paneIndex = idx + 1;
          let primary: AnySeries | null = null;
          for (const out of outs.get(ind.key) ?? []) {
            const s = makeSeries(out, paneIndex, ind.def.scale);
            paneSeries.set(seriesKey(ind, out), s);
            if (out.role === "primary" || !primary) primary = s;
          }
          if (ind.def.guides && primary) {
            for (const g of ind.def.guides) {
              guides.push(
                (primary as ISeriesApi<"Line">).createPriceLine({ price: g, color: c.theme.line, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "" }),
              );
            }
          }
        });
        const panes = chart.panes();
        panes[0]?.setStretchFactor(3);
        for (let i = 1; i < panes.length; i++) panes[i]?.setStretchFactor(1);
        lastPaneSig = paneSig;
      }
      pane.forEach((ind) => {
        for (const out of outs.get(ind.key) ?? []) {
          const s = paneSeries.get(seriesKey(ind, out));
          if (s) fill(s, out, c.theme, colorFor(out.role, c.theme.action));
        }
      });

      rebuildLegend(price, pane, outs, palette, c.theme);
      chart.timeScale().fitContent();
    }

    function rebuildLegend(
      price: ActiveIndicator[],
      pane: ActiveIndicator[],
      outs: Map<string, IndicatorOutput[]>,
      palette: string[],
      theme: RenderTheme,
    ): void {
      legendEl.replaceChildren();
      const entry = (color: string, label: string, lv: number | null): void => {
        const row = document.createElement("div");
        row.className = "mu-ind-legend__row";
        const dot = document.createElement("span");
        dot.className = "mu-ind-legend__dot";
        dot.style.background = color;
        const tx = document.createElement("span");
        tx.className = "mu-ind-legend__label";
        tx.textContent = lv != null ? `${label}  ${lv.toFixed(2)}` : label;
        row.append(dot, tx);
        legendEl.appendChild(row);
      };
      price.forEach((ind, idx) => entry(palette[idx % palette.length]!, ind.label, lastValueOf(outs.get(ind.key) ?? [])));
      pane.forEach((ind) => entry(theme.action, ind.label, lastValueOf(outs.get(ind.key) ?? [])));
      legendEl.style.display = price.length + pane.length ? "" : "none";
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
        legendEl.remove();
        chart.remove();
      },
    } satisfies RendererInstance;
  },
};

const candleColors = (theme: RenderTheme) => ({
  upColor: theme.system,
  downColor: theme.danger,
  wickUpColor: theme.system,
  wickDownColor: theme.danger,
  borderVisible: false,
});

export default plugin;
