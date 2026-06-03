import type { FetchResult } from "@mu/protocol";
import type { OhlcvRecord as Rec } from "./shapes/ohlcv.js";

const DAY_MS = 86_400_000;

/** Build deterministic daily OHLCV bars starting at a UTC date, `count` days. */
export function bars(startISO: string, count: number, base = 100): Rec[] {
  const start = Date.parse(startISO + "T00:00:00Z");
  const out: Rec[] = [];
  for (let i = 0; i < count; i++) {
    const close = base + i;
    out.push({
      t: start + i * DAY_MS,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      adjClose: close,
      volume: 1_000_000 + i,
    });
  }
  return out;
}

/** Wrap canonical bars into a FetchResult for a given identity. */
export function ohlcvFetch(
  rows: Rec[],
  opts: { provider?: string; entity?: string; resolution?: string; fetchedAt?: number } = {},
): FetchResult {
  const provider = opts.provider ?? "yfinance";
  const entity = opts.entity ?? "AMZN";
  const resolution = opts.resolution ?? "1d";
  return {
    descriptor: {
      shape: "ohlcv",
      identity: { provider, shape: "ohlcv", entity, tail: [resolution] },
      queryParams: { range: "test" },
    },
    payload: rows,
    provenance: {
      source: provider,
      fetchedAt: opts.fetchedAt ?? 1_700_000_000_000,
      trigger: "on_demand",
      queryParams: { range: "test" },
    },
  };
}
