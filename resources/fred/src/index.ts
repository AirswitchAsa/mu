import {
  MuErrorException,
  type FetchResult,
  type ResourceManifest,
} from "@mu/protocol";
import type { FetchContext, FetchParams, Resource } from "@mu/resource-sdk";

// =============================================================================
// µ — FRED/ALFRED resource: economic `releases` (point-in-time). Each observation
// becomes a releases row; `as_of` is the vintage (the FRED real-time start when
// available, else fetch time), so revisions accrue as new rows — true PIT. FRED
// carries no consensus forecast, so `forecast` is left empty (earnings via Finnhub
// fills that lane). Keyed via FRED_API_KEY. `fetchJson` injectable for offline tests.
// =============================================================================

export type FetchJson = (url: string) => Promise<unknown>;

const realFetchJson: FetchJson = async (url) => {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new MuErrorException("FETCH_FAILED", `HTTP ${r.status} from fred`);
  return r.json();
};

const DEFAULT_LIMIT = 36;

/** Friendly labels for common FRED series ids (the card shows `name`, not the id). */
const SERIES_NAMES: Record<string, string> = {
  GDP: "GDP",
  GDPC1: "Real GDP",
  CPIAUCSL: "CPI",
  CPILFESL: "Core CPI",
  PCEPI: "PCE price index",
  UNRATE: "Unemployment rate",
  PAYEMS: "Nonfarm payrolls",
  ICSA: "Initial jobless claims",
  FEDFUNDS: "Fed funds rate",
  DGS10: "10Y Treasury yield",
  DGS2: "2Y Treasury yield",
  INDPRO: "Industrial production",
  RSAFS: "Retail sales",
  HOUST: "Housing starts",
  PPIACO: "PPI (all commodities)",
  M2SL: "M2 money supply",
  UMCSENT: "U. Michigan sentiment",
  T10Y2Y: "10Y–2Y spread",
};

interface FredObs {
  realtime_start?: string;
  realtime_end?: string;
  date?: string;
  value?: string;
}

function releaseRecords(obs: readonly FredObs[], series: string, asOfNow: number): Record<string, unknown>[] {
  const id = series.toUpperCase();
  const out: Record<string, unknown>[] = [];
  for (const o of obs) {
    if (!o.date) continue;
    if (o.value === undefined || o.value === ".") continue; // missing observation → skip
    const value = Number(o.value);
    if (!Number.isFinite(value)) continue;
    const release = Date.parse(`${o.date}T12:00:00Z`);
    if (!Number.isFinite(release)) continue;
    const vintage = o.realtime_start ? Date.parse(`${o.realtime_start}T12:00:00Z`) : NaN;
    out.push({
      event: id,
      name: SERIES_NAMES[id] ?? id,
      reference_period: o.date,
      as_of: Number.isFinite(vintage) ? vintage : asOfNow,
      release_time: release,
      status: "released",
      forecast: undefined,
      actual: value,
      previous: undefined,
      unit: undefined,
      importance: "med",
    });
  }
  return out;
}

export function createFredResource(deps: { fetchJson?: FetchJson; apiKey?: string } = {}): Resource {
  const fetchJson = deps.fetchJson ?? realFetchJson;
  const key = (): string | undefined => deps.apiKey ?? process.env["FRED_API_KEY"];

  const manifest: ResourceManifest = {
    id: "fred",
    shapes: ["releases"],
    params: [
      { name: "entity", required: true, description: "FRED series id, e.g. GDP, CPIAUCSL, UNRATE" },
      { name: "range", required: false, description: "ignored; latest observations are returned" },
    ],
    configSchema: ["FRED_API_KEY"],
    cadence: { everyMs: 6 * 60 * 60_000 },
  };

  return {
    manifest,
    isConfigured: () => Boolean(key()),
    async fetch(params: FetchParams, ctx: FetchContext): Promise<FetchResult> {
      if (params.shape !== "releases") {
        throw new MuErrorException("UNKNOWN_SOURCE", `fred does not produce shape '${params.shape}'`);
      }
      const token = key();
      if (!token) throw new MuErrorException("NOT_CONFIGURED", "fred: FRED_API_KEY is not set");
      const series = params.entity;
      const url =
        `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(series)}` +
        `&api_key=${token}&file_type=json&sort_order=desc&limit=${DEFAULT_LIMIT}`;
      const raw = (await fetchJson(url)) as { observations?: FredObs[] };
      const payload = releaseRecords(raw?.observations ?? [], series, ctx.now());
      return {
        descriptor: {
          shape: "releases",
          identity: { provider: "fred", shape: "releases", entity: series, tail: [] },
          queryParams: { entity: series },
        },
        provenance: { source: "fred", fetchedAt: ctx.now(), trigger: ctx.trigger, queryParams: { entity: series } },
        payload,
      };
    },
  };
}

export const resource = createFredResource();
export default resource;
