// =============================================================================
// µ — baked sample data for the news + point-in-time release cards (v0).
//
// IMPORTANT (next round): these are PLACEHOLDERS. The news + releases card types
// render the design faithfully, but there is no live data plane behind them yet —
// no `news` / `releases` broker shape, no resource, no handle → resolve path. When
// the data plane lands, these renderers should read resolved rows for their bound
// handle exactly like the charts do, and this file goes away. See
// docs/spec/components/renderer.dog.md ("News + point-in-time — deferred").
// =============================================================================

export interface NewsItem {
  id: string;
  source: string;
  /** minutes ago (relative offset; a live feed would carry timestamps). */
  mins: number;
  tickers: string[];
  /** short label for the monochrome thumbnail slot, or null for a text-only item. */
  thumb: string | null;
  /** sentiment of the thumbnail sparkline. */
  kind?: "up" | "down" | "flat";
  headline: string;
  summary?: string;
}

export const NEWS_FEED: readonly NewsItem[] = [
  { id: "n1", source: "reuters", mins: 6, tickers: ["AMZN"], thumb: "AMZN", kind: "up",
    headline: "Amazon lifts AWS capacity guidance for the second half",
    summary: "The cloud unit said it would bring forward data-center buildout, citing sustained demand from inference workloads." },
  { id: "n2", source: "the desk", mins: 21, tickers: ["SPY"], thumb: null,
    headline: "Breadth narrows as a handful of megacaps carry the tape" },
  { id: "n3", source: "bloomberg", mins: 44, tickers: ["NVDA"], thumb: "NVDA", kind: "flat",
    headline: "Nvidia H200 supply normalizes as foundry yields improve",
    summary: "Channel checks point to shorter lead times into the third quarter." },
  { id: "n4", source: "ft", mins: 71, tickers: ["TLT"], thumb: null,
    headline: "Treasury yields ease after a softer services print" },
  { id: "n5", source: "wsj", mins: 96, tickers: ["MSFT"], thumb: "MSFT", kind: "up",
    headline: "Microsoft closes an Activision integration milestone ahead of plan",
    summary: "Engineering teams merged onto a shared build pipeline a quarter early." },
  { id: "n6", source: "the desk", mins: 132, tickers: ["SPY", "TLT"], thumb: null,
    headline: "Fed minutes show a split on the timing of the next cut" },
  { id: "n7", source: "reuters", mins: 168, tickers: [], thumb: "OIL", kind: "down",
    headline: "Oil holds its range as OPEC+ keeps quotas unchanged",
    summary: "Ministers deferred a quota decision to the next scheduled meeting." },
  { id: "n8", source: "bloomberg", mins: 214, tickers: ["TLT"], thumb: null,
    headline: "Long bonds see the largest weekly inflow since January" },
  { id: "n9", source: "ft", mins: 286, tickers: ["AMZN", "MSFT"], thumb: "CLD", kind: "up",
    headline: "Cloud capex commentary sets a constructive tone into earnings",
    summary: "Hyperscaler guidance suggests the spend cycle has further to run." },
];

export type ReleaseStatus = "released" | "revised" | "scheduled";

export interface ReleaseEvent {
  id: string;
  series: string;
  handle: string;
  /** reference period (the vintage this release covers). */
  period: string;
  /** hours from now; negative = already released. */
  hrs: number;
  status: ReleaseStatus;
  actual?: string;
  forecast?: string;
  imp: "high" | "med" | "low";
}

export const RELEASES: readonly ReleaseEvent[] = [
  { id: "r1", series: "ism services pmi", handle: "fred:ism:services", period: "may 2026", hrs: -2, status: "released", actual: "52.1", forecast: "51.5", imp: "med" },
  { id: "r2", series: "us retail sales", handle: "fred:rsafs", period: "apr 2026", hrs: -18, status: "released", actual: "+0.4%", forecast: "+0.3%", imp: "med" },
  { id: "r3", series: "us gdp · q1 final", handle: "bea:gdp:q1", period: "q1 2026", hrs: -26, status: "revised", actual: "2.4%", forecast: "2.1%", imp: "high" },
  { id: "r4", series: "initial claims", handle: "dol:icsa", period: "wk 05-30", hrs: -44, status: "released", actual: "219k", forecast: "225k", imp: "low" },
  { id: "r5", series: "amzn · q1 earnings", handle: "tiingo:amzn:eps", period: "q1 2026", hrs: -70, status: "released", actual: "1.12", forecast: "0.98", imp: "high" },
  { id: "r6", series: "nonfarm payrolls", handle: "bls:nfp", period: "may 2026", hrs: 5, status: "scheduled", forecast: "175k", imp: "high" },
  { id: "r7", series: "umich sentiment", handle: "umich:sent", period: "jun 2026", hrs: 27, status: "scheduled", forecast: "69.2", imp: "low" },
  { id: "r8", series: "us cpi · yoy", handle: "bls:cpi:yoy", period: "may 2026", hrs: 52, status: "scheduled", forecast: "3.1%", imp: "high" },
  { id: "r9", series: "msft · q3 earnings", handle: "tiingo:msft:eps", period: "q3 2026", hrs: 98, status: "scheduled", forecast: "2.94", imp: "high" },
  { id: "r10", series: "fomc rate decision", handle: "fed:fomc", period: "jun 2026", hrs: 220, status: "scheduled", forecast: "hold", imp: "high" },
];

/** The next upcoming (future) release, or null if none. */
export function nextRelease(rows: readonly ReleaseEvent[] = RELEASES): ReleaseEvent | null {
  const up = rows.filter((r) => r.hrs > 0).sort((a, b) => a.hrs - b.hrs);
  return up[0] ?? null;
}
