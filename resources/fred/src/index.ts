import {
  MuErrorException,
  type FetchResult,
  type ResourceManifest,
} from "@mu/protocol";
import type { FetchContext, FetchParams, Resource } from "@mu/resource-sdk";

// =============================================================================
// µ — FRED/ALFRED resource: economic `releases` with the FULL point-in-time
// revision trail. FRED's plain observations endpoint returns only the *latest*
// value per date; ALFRED (the same endpoint + real-time params) returns every
// vintage — the value as it was first published and as each revision changed it.
// We fetch the trail with `output_type=2` over a bounded window of recent periods
// so a revision becomes a NEW row (later `as_of`), never an overwrite — true
// bitemporal data the store can read "as of" any date.
//
// Handle contract (so other macro sources stay consistent): a macro release is
//   <provider>:releases:<SERIES_ID>
// and each row is { event, name, reference_period, as_of (=vintage),
//   release_time, status (released→revised), actual, previous?, unit }. The
// vintage axis is `as_of`; a later vintage of the same (event, reference_period)
// is a revision. Never overwrite a vintage — emit a new row. FRED carries no
// consensus forecast, so `forecast` is empty (earnings via Finnhub fills it).
// Keyed via FRED_API_KEY. `fetchJson` is injectable for offline tests.
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

/** How many recent reference periods to pull the full revision trail for. */
const DEFAULT_PERIODS = 24;
const MAX_PERIODS = 60;

/** Parse the `range` param (a period count) into a clamped K. */
function periodsOf(range: string | undefined): number {
  const n = range ? Number.parseInt(range, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PERIODS;
  return Math.min(n, MAX_PERIODS);
}

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

interface CleanObs {
  date: string;
  value: number;
  release: number; // reference date as epoch-ms
  vintage: number; // realtime_start as epoch-ms (NaN if absent)
}

function cleanObs(obs: readonly FredObs[]): CleanObs[] {
  const out: CleanObs[] = [];
  for (const o of obs) {
    if (!o.date) continue;
    if (o.value === undefined || o.value === ".") continue; // missing observation → skip
    const value = Number(o.value);
    if (!Number.isFinite(value)) continue;
    const release = Date.parse(`${o.date}T12:00:00Z`);
    if (!Number.isFinite(release)) continue;
    const vintage = o.realtime_start ? Date.parse(`${o.realtime_start}T12:00:00Z`) : NaN;
    out.push({ date: o.date, value, release, vintage });
  }
  return out;
}

/** A single value at a single vintage in a reference period's revision trail. */
interface Vintage {
  asOf: number; // vintage date as epoch-ms
  value: number;
}

const VINTAGE_COL = /_(\d{8})$/; // ALFRED wide columns are "<SERIES>_YYYYMMDD"

/**
 * Parse one ALFRED `output_type=2` (wide) row into a reference period's revision
 * trail. Each row is `{ date, <SERIES>_YYYYMMDD: value, ... }` — one column per
 * vintage date, the value repeated until it actually changed. We keep only the
 * vintages where the value CHANGED, which is the genuine revision trail (and makes
 * an unrevised series collapse to a single vintage).
 */
function trailOf(row: Record<string, unknown>): Vintage[] {
  const cells: Vintage[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (k === "date") continue;
    const m = VINTAGE_COL.exec(k);
    if (!m || v === "." || v == null) continue;
    const value = Number(v);
    if (!Number.isFinite(value)) continue;
    const d = m[1]!;
    const asOf = Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T12:00:00Z`);
    if (!Number.isFinite(asOf)) continue;
    cells.push({ asOf, value });
  }
  cells.sort((a, b) => a.asOf - b.asOf);
  const trail: Vintage[] = [];
  for (const c of cells) {
    const last = trail[trail.length - 1];
    if (!last || last.value !== c.value) trail.push(c); // drop consecutive repeats
  }
  return trail;
}

/**
 * Turn the ALFRED wide vintage observations into releases rows: one row per
 * genuine vintage, the earliest "released" and every revision "revised".
 * `previous` is the prior period's current (latest-vintage) value.
 */
function vintageRecords(
  obs: readonly Record<string, unknown>[],
  id: string,
  name: string,
  unit: string | undefined,
): Record<string, unknown>[] {
  const byPeriod = new Map<string, Vintage[]>();
  for (const row of obs) {
    const date = row["date"];
    if (typeof date !== "string") continue;
    const trail = trailOf(row);
    if (trail.length) byPeriod.set(date, trail);
  }

  const periodsAsc = [...byPeriod.keys()].sort((a, b) => Date.parse(a) - Date.parse(b));
  const latestVal = new Map<string, number>();
  for (const [k, trail] of byPeriod) latestVal.set(k, trail[trail.length - 1]!.value);
  const prevOf = new Map<string, number | undefined>();
  periodsAsc.forEach((k, i) => prevOf.set(k, i > 0 ? latestVal.get(periodsAsc[i - 1]!) : undefined));

  const out: Record<string, unknown>[] = [];
  for (const [k, trail] of byPeriod) {
    const release = Date.parse(`${k}T12:00:00Z`);
    trail.forEach((t, idx) => {
      out.push({
        event: id,
        name,
        reference_period: k,
        as_of: t.asOf,
        release_time: release,
        status: idx === 0 ? "released" : "revised",
        forecast: undefined,
        actual: t.value,
        previous: prevOf.get(k),
        unit,
        importance: "med",
      });
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
      {
        name: "entity",
        required: true,
        description:
          "FRED series id. Common: GDP, CPIAUCSL (CPI), CPILFESL (core CPI), PCEPILFE " +
          "(core PCE), UNRATE, PAYEMS, ICSA, JTSJOL (JOLTS), FEDFUNDS, DGS2/DGS10/DGS30, " +
          "T10Y2Y, T10YIE, MORTGAGE30US, INDPRO, RSAFS, HOUST, M2SL, UMCSENT, WALCL. " +
          "Any other FRED series id also works (auto-named from FRED metadata).",
      },
      {
        name: "range",
        required: false,
        description:
          "number of recent reference periods to fetch, each with its full ALFRED " +
          `revision trail (default ${DEFAULT_PERIODS}, max ${MAX_PERIODS}).`,
      },
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
      const k = periodsOf(params.range);

      const obsBase = `https://api.stlouisfed.org/fred/series/observations?series_id=${enc}&api_key=${token}&file_type=json`;
      // Round 1: the latest K observations (to bound the window) + best-effort metadata.
      const latestUrl = `${obsBase}&sort_order=desc&limit=${k}&output_type=1`;
      const metaUrl = `https://api.stlouisfed.org/fred/series?series_id=${enc}&api_key=${token}&file_type=json`;
      const [latestRaw, metaRaw] = await Promise.all([
        fetchJson(latestUrl),
        fetchJson(metaUrl).catch(() => undefined),
      ]);
      assertOk(latestRaw);

      const curated = CATALOG[id];
      const meta = (metaRaw as { seriess?: FredSeriesMeta[] } | undefined)?.seriess?.[0];
      const name = curated?.name ?? (meta?.title && meta.title.trim()) ?? id;
      const unit = curated?.unit ?? meta?.units_short ?? meta?.units ?? undefined;

      const descriptor = {
        shape: "releases" as const,
        identity: { provider: "fred", shape: "releases", entity: series, tail: [] },
        queryParams: { entity: series, range: String(k) },
      };
      const provenance = {
        source: "fred",
        fetchedAt: ctx.now(),
        trigger: ctx.trigger,
        queryParams: { entity: series, range: String(k) },
      };

      const latest = cleanObs((latestRaw as { observations?: FredObs[] })?.observations ?? []);
      if (latest.length === 0) return { descriptor, provenance, payload: [] };
      // latest is newest-first; the oldest of the K is our observation_start window edge.
      const windowStart = latest[latest.length - 1]!.date;

      // Round 2: the full revision trail for the K periods (ALFRED wide pivot,
      // output_type=2). realtime_start = windowStart bounds the vintage columns to
      // the relevant span — capturing each period's first print without tripping
      // FRED's 2000-vintage-date cap on long daily series.
      const vintageUrl =
        `${obsBase}&observation_start=${windowStart}&output_type=2` +
        `&realtime_start=${windowStart}&sort_order=asc`;
      const vintageRaw = assertOk(await fetchJson(vintageUrl));
      const vintages = (vintageRaw as { observations?: Record<string, unknown>[] })?.observations ?? [];

      const payload = vintageRecords(vintages, id, name, unit);
      return { descriptor, provenance, payload };
    },
  };
}

export const resource = createFredResource();
export default resource;
