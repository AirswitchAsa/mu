import {
  MuErrorException,
  type FetchResult,
  type ResourceManifest,
} from "@mu/protocol";
import type { FetchContext, FetchParams, Resource } from "@mu/resource-sdk";

/** The slice of yahoo-finance2's `chart()` result we depend on (decoupled for testing). */
export interface ChartQuote {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  adjclose?: number | null;
  volume: number | null;
}
export interface ChartResult {
  quotes: ChartQuote[];
}
export type ChartFn = (
  symbol: string,
  opts: { period1?: Date; period2?: Date; interval?: string },
) => Promise<ChartResult>;

const RANGE_DAYS: Record<string, number> = {
  "5d": 5,
  "1mo": 31,
  "3mo": 93,
  "6mo": 186,
  "1y": 366,
  "2y": 731,
  "5y": 1827,
  max: 36500,
};

const DAY_MS = 86_400_000;

function rangeToPeriod1(range: string | undefined, now: number): Date {
  const days = (range && RANGE_DAYS[range]) || RANGE_DAYS["1y"]!;
  return new Date(now - days * DAY_MS);
}

function toInterval(resolution: string): string {
  if (resolution === "1wk" || resolution === "1w") return "1wk";
  if (resolution === "1mo") return "1mo";
  return "1d";
}

/**
 * The real chart client: yahoo-finance2 v3 must be instantiated (`new YahooFinance()`),
 * not called on the default export. Lazily imported and cached so the lib loads
 * only when used and only once.
 */
let yfInstance: { chart: ChartFn } | undefined;
const realChart: ChartFn = async (symbol, opts) => {
  if (!yfInstance) {
    const mod = await import("yahoo-finance2");
    const YahooFinance = (mod.default ?? mod) as new () => { chart: ChartFn };
    yfInstance = new YahooFinance();
  }
  return yfInstance.chart(symbol, opts);
};

const MANIFEST: ResourceManifest = {
  id: "yfinance",
  shapes: ["ohlcv"],
  params: [
    { name: "entity", required: true, description: "ticker symbol, e.g. AMZN" },
    { name: "resolution", required: false, description: "1d (default) | 1wk | 1mo" },
    { name: "range", required: false, description: "5d|1mo|3mo|6mo|1y|2y|5y|max" },
    { name: "start", required: false, description: "epoch-ms inclusive start" },
    { name: "end", required: false, description: "epoch-ms inclusive end" },
  ],
  // zero-config: no configSchema → always available.
};

/**
 * Build the yfinance resource (resource.dog.md starter). Zero-config OHLCV via
 * yahoo-finance2; the chart client is injectable so normalization is tested offline.
 */
export function createYahooResource(deps: { chart?: ChartFn } = {}): Resource {
  const chart = deps.chart ?? realChart;
  return {
    manifest: MANIFEST,
    async fetch(params: FetchParams, ctx: FetchContext): Promise<FetchResult> {
      if (params.shape !== "ohlcv") {
        throw new MuErrorException("UNKNOWN_SOURCE", `yfinance does not produce shape '${params.shape}'`);
      }
      const symbol = params.entity;
      const resolution = params.resolution ?? "1d";
      const period2 = params.end !== undefined ? new Date(params.end) : new Date(ctx.now());
      const period1 =
        params.start !== undefined ? new Date(params.start) : rangeToPeriod1(params.range, ctx.now());

      const result = await chart(symbol, { period1, period2, interval: toInterval(resolution) });

      // Drop incomplete bars (null OHLC from holidays/halts); normalize to canonical.
      const payload = result.quotes
        .filter((q) => q.open != null && q.high != null && q.low != null && q.close != null)
        .map((q) => ({
          t: q.date.getTime(),
          open: q.open!,
          high: q.high!,
          low: q.low!,
          close: q.close!,
          adjClose: q.adjclose ?? q.close!,
          volume: q.volume ?? 0,
        }));

      const queryParams = {
        resolution,
        range: params.range,
        start: params.start,
        end: params.end,
      };

      return {
        descriptor: {
          shape: "ohlcv",
          identity: { provider: "yfinance", shape: "ohlcv", entity: symbol.toUpperCase(), tail: [resolution] },
          queryParams,
        },
        payload,
        provenance: {
          source: "yfinance",
          fetchedAt: ctx.now(),
          trigger: ctx.trigger,
          queryParams,
          upstream: { symbol, interval: toInterval(resolution) },
        },
      };
    },
  };
}

export const resource = createYahooResource();
export default resource;
