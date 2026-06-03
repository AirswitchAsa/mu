import { LineSeries, type ISeriesApi } from "lightweight-charts";
import { indexNormalize } from "../../lib/indicators";
import { compareBase } from "../../lib/specs";
import { applyBaseTheme, createBaseChart, lineData, observeResize, seriesColors } from "../chart-base";
import type { RenderContext, RendererInstance, RendererPlugin } from "../types";

// =============================================================================
// compare — index-normalized multi-instrument overlay. Each bound handle becomes
// one line, rebased to spec.base (default 100) so shapes line up regardless of
// price. Lines reconcile by handle as bindings change.
// =============================================================================

const plugin: RendererPlugin = {
  type: "compare",
  mount(el, ctx) {
    const chart = createBaseChart(el, ctx.theme);
    const lines = new Map<string, ISeriesApi<"Line">>();
    const ro = observeResize(el, chart);
    let last: RenderContext = ctx;

    function render(c: RenderContext): void {
      last = c;
      const base = compareBase(c.spec);
      const colors = seriesColors(c.theme);
      const wanted = new Set(c.handles);
      for (const [handle, series] of lines) {
        if (!wanted.has(handle)) {
          chart.removeSeries(series);
          lines.delete(handle);
        }
      }
      c.handles.forEach((handle, i) => {
        let series = lines.get(handle);
        if (!series) {
          series = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 3 });
          lines.set(handle, series);
        }
        series.applyOptions({ color: colors[i % colors.length] });
        series.setData(lineData(indexNormalize(c.data.get(handle) ?? [], base)));
      });
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
