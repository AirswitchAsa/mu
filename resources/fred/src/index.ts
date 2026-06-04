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
  try {
    return await r.json();
  } catch {
    throw new MuErrorException("FETCH_FAILED", "fred: non-JSON response (rate-limited or upstream error)");
  }
};

const DEFAULT_LIMIT = 36;

/**
 * Curated catalog: reader-friendly `name` + `unit` for the common FRED series (the
 * card shows these, never the raw id). This is not exhaustive — any other series is
 * still fetchable and gets its proper title/unit from the FRED series-metadata
 * endpoint at fetch time, so a raw code like "CPIAUCSL" never reaches the card.
 */
const CATALOG: Record<string, { name: string; unit?: string }> = {
  // output
  GDP: { name: "Gross Domestic Product", unit: "Bil. of $" },
  GDPC1: { name: "Real Gross Domestic Product", unit: "Bil. of $" },
  GDPDEF: { name: "GDP Deflator", unit: "Index 2017=100" },
  INDPRO: { name: "Industrial Production", unit: "Index 2017=100" },
  // prices / inflation
  CPIAUCSL: { name: "Consumer Price Index", unit: "Index 1982-1984=100" },
  CPILFESL: { name: "Core Consumer Price Index", unit: "Index 1982-1984=100" },
  PCEPI: { name: "PCE Price Index", unit: "Index 2017=100" },
  PCEPILFE: { name: "Core PCE Price Index", unit: "Index 2017=100" },
  PPIACO: { name: "Producer Price Index (All Commodities)", unit: "Index 1982=100" },
  T10YIE: { name: "10-Year Breakeven Inflation Rate", unit: "%" },
  // labor
  UNRATE: { name: "Unemployment Rate", unit: "%" },
  PAYEMS: { name: "Nonfarm Payrolls", unit: "Thous. of Persons" },
  ICSA: { name: "Initial Jobless Claims", unit: "Claims" },
  JTSJOL: { name: "Job Openings (JOLTS)", unit: "Thous." },
  CES0500000003: { name: "Average Hourly Earnings", unit: "$ / hour" },
  // rates
  FEDFUNDS: { name: "Federal Funds Rate", unit: "%" },
  DFF: { name: "Effective Federal Funds Rate", unit: "%" },
  DGS2: { name: "2-Year Treasury Yield", unit: "%" },
  DGS10: { name: "10-Year Treasury Yield", unit: "%" },
  DGS30: { name: "30-Year Treasury Yield", unit: "%" },
  T10Y2Y: { name: "10Y–2Y Treasury Spread", unit: "%" },
  MORTGAGE30US: { name: "30-Year Fixed Mortgage Rate", unit: "%" },
  // activity / money
  RSAFS: { name: "Retail Sales", unit: "Mil. of $" },
  HOUST: { name: "Housing Starts", unit: "Thous. of Units" },
  M2SL: { name: "M2 Money Supply", unit: "Bil. of $" },
  WALCL: { name: "Fed Total Assets (Balance Sheet)", unit: "Mil. of $" },
  UMCSENT: { name: "University of Michigan Consumer Sentiment", unit: "Index 1966:Q1=100" },
};

interface FredObs {
  realtime_start?: string;
  realtime_end?: string;
  date?: string;
  value?: string;
}

interface FredSeriesMeta {
  id?: string;
  title?: string;
  units?: string;
  units_short?: string;
}

/** Throw if FRED returned a JSON error envelope (it can do so with HTTP 200). */
function assertOk(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const msg = (raw as { error_message?: unknown }).error_message;
    if (typeof msg === "string") throw new MuErrorException("FETCH_FAILED", `fred: ${msg}`);
  }
  return raw;
}

function cleanObs(obs: readonly FredObs[]): { o: FredObs; value: number; release: number; vintage: number }[] {
  const out: { o: FredObs; value: number; release: number; vintage: number }[] = [];
  for (const o of obs) {
    if (!o.date) continue;
    if (o.value === undefined || o.value === ".") continue; // missing observation → skip
    const value = Number(o.value);
    if (!Number.isFinite(value)) continue;
    const release = Date.parse(`${o.date}T12:00:00Z`);
    if (!Number.isFinite(release)) continue;
    const vintage = o.realtime_start ? Date.parse(`${o.realtime_start}T12:00:00Z`) : NaN;
    out.push({ o, value, release, vintage });
  }
  return out;
}

function releaseRecords(
  obs: readonly FredObs[],
  id: string,
  asOfNow: number,
  name: string,
  unit: string | undefined,
): Record<string, unknown>[] {
  // FRED returns newest-first (sort_order=desc), so the *next* clean entry is the
  // chronologically prior period — exactly the "previous" print.
  const clean = cleanObs(obs);
  return clean.map((c, i) => ({
    event: id,
    name,
    reference_period: c.o.date,
    as_of: Number.isFinite(c.vintage) ? c.vintage : asOfNow,
    release_time: c.release,
    status: "released",
    forecast: undefined,
    actual: c.value,
    previous: clean[i + 1]?.value,
    unit,
    importance: "med",
  }));
}

export function createFredResource(deps: { fetchJson?: FetchJson; apiKey?: string } = {}): Resource {
  const fetchJson = deps.fetchJson ?? realFetchJson;
  const key = (): string | undefined => deps.apiKey ?? process.env["FRED_API_KEY"];

  const manifest: ResourceManifest = {
    id: "fred",
    shapes: ["releases"],
    params: [
      {
        name: "entity",
        required: true,
        description:
          "FRED series id. Common: GDP, CPIAUCSL (CPI), CPILFESL (core CPI), PCEPILFE " +
          "(core PCE), UNRATE, PAYEMS, ICSA, JTSJOL (JOLTS), FEDFUNDS, DGS2/DGS10/DGS30, " +
          "T10Y2Y, T10YIE, MORTGAGE30US, INDPRO, RSAFS, HOUST, M2SL, UMCSENT, WALCL. " +
          "Any other FRED series id also works (auto-named from FRED metadata).",
      },
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
      const id = series.toUpperCase();
      const enc = encodeURIComponent(series);
      const obsUrl =
        `https://api.stlouisfed.org/fred/series/observations?series_id=${enc}` +
        `&api_key=${token}&file_type=json&sort_order=desc&limit=${DEFAULT_LIMIT}`;
      const metaUrl = `https://api.stlouisfed.org/fred/series?series_id=${enc}&api_key=${token}&file_type=json`;

      // Observations are required; series metadata is best-effort (names/units fallback).
      const [obsRaw, metaRaw] = await Promise.all([
        fetchJson(obsUrl),
        fetchJson(metaUrl).catch(() => undefined),
      ]);
      assertOk(obsRaw);
      const observations = (obsRaw as { observations?: FredObs[] })?.observations ?? [];
      const meta = (metaRaw as { seriess?: FredSeriesMeta[] } | undefined)?.seriess?.[0];

      const curated = CATALOG[id];
      const name = curated?.name ?? (meta?.title && meta.title.trim()) ?? id;
      const unit = curated?.unit ?? meta?.units_short ?? meta?.units ?? undefined;

      const payload = releaseRecords(observations, id, ctx.now(), name, unit);
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
