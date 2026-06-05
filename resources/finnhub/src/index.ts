import {
  MuErrorException,
  type FetchResult,
  type ResourceManifest,
} from "@mu/protocol";
import type { FetchContext, FetchParams, Resource } from "@mu/resource-sdk";

// =============================================================================
// µ — Finnhub resource: per-ticker `news` (company-news) and `releases` (earnings
// calendar, EPS estimate vs actual). Keyed via FINNHUB_API_KEY; dormant until a
// key is present (isConfigured). Each earnings row is stamped with `as_of = now`,
// so a later refresh once the actual prints lands a NEW vintage — point-in-time
// by construction. `fetchJson` is injectable so normalization is tested offline.
// =============================================================================

export type FetchJson = (url: string) => Promise<unknown>;

const realFetchJson: FetchJson = async (url) => {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new MuErrorException("FETCH_FAILED", `HTTP ${r.status} from finnhub`);
  try {
    return await r.json();
  } catch {
    throw new MuErrorException("FETCH_FAILED", "finnhub: non-JSON response (rate-limited or upstream error)");
  }
};

/**
 * Finnhub can answer HTTP 200 with `{ "error": "..." }` (invalid symbol, rate limit on
 * the free tier). Surface it as a typed error instead of silently returning empty.
 */
function assertOk(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const e = (raw as { error?: unknown }).error;
    if (typeof e === "string" && e.length > 0) throw new MuErrorException("FETCH_FAILED", `finnhub: ${e}`);
  }
  return raw;
}

/**
 * Fill `previous` per event from the prior period's actual (chronological order). A
 * scheduled row's `previous` is therefore the last reported number — handy on the card.
 */
function withPrevious(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byEvent = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const e = r["event"] as string;
    const list = byEvent.get(e);
    if (list) list.push(r);
    else byEvent.set(e, [r]);
  }
  for (const list of byEvent.values()) {
    list.sort((a, b) => (a["release_time"] as number) - (b["release_time"] as number));
    for (let i = 1; i < list.length; i++) {
      const prevActual = list[i - 1]!["actual"];
      if (typeof prevActual === "number") list[i]!["previous"] = prevActual;
    }
  }
  return rows;
}

const DAY_MS = 86_400_000;
const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

interface FinnhubNews {
  id?: number;
  datetime?: number; // epoch-seconds
  headline?: string;
  source?: string;
  summary?: string;
  url?: string;
  related?: string;
  image?: string;
}

interface FinnhubEarning {
  date?: string; // YYYY-MM-DD (report date)
  epsActual?: number | null;
  epsEstimate?: number | null;
  revenueActual?: number | null;
  revenueEstimate?: number | null;
  quarter?: number;
  year?: number;
  symbol?: string;
}

interface FinnhubSurprise {
  period?: string; // YYYY-MM-DD (fiscal period end)
  quarter?: number;
  year?: number;
  actual?: number | null;
  estimate?: number | null;
  symbol?: string;
}

const refPeriod = (year?: number, quarter?: number, fallback?: string): string =>
  year && quarter ? `${year} Q${quarter}` : fallback ?? "";

// ---- key_stats (cross-section) ---------------------------------------------

/** Compact magnitude: 1.34e11 → "134.0B". */
const compact = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
};

type Fmt = "usd_m" | "price" | "count_m" | "ratio" | "pct" | "str";

/** Format a raw value into a display-ready string; undefined drops the row. */
function fmtStat(fmt: Fmt, raw: unknown): string | undefined {
  if (fmt === "str") return typeof raw === "string" && raw.length > 0 ? raw : undefined;
  const n = num(raw);
  if (n === undefined) return undefined;
  switch (fmt) {
    case "usd_m":
      return `$${compact(n * 1e6)}`; // Finnhub reports market cap in $millions
    case "price":
      return `$${n.toFixed(2)}`;
    case "count_m":
      return compact(n * 1e6); // shares / volume reported in millions
    case "ratio":
      return n.toFixed(2);
    case "pct":
      return `${n.toFixed(2)}%`;
  }
}

interface StatSpec {
  key: string;
  label: string;
  group: "profile" | "valuation" | "trading";
  fmt: Fmt;
  from: "profile" | "metric";
}

/**
 * The curated key-stats panel. Each entry has a reader-friendly label, a panel
 * group, and a formatter, so nothing cryptic reaches the card. A field absent from
 * the upstream payload is simply skipped (no empty rows).
 */
const STAT_FIELDS: readonly StatSpec[] = [
  { key: "name", label: "Company", group: "profile", fmt: "str", from: "profile" },
  { key: "finnhubIndustry", label: "Sector", group: "profile", fmt: "str", from: "profile" },
  { key: "exchange", label: "Exchange", group: "profile", fmt: "str", from: "profile" },
  { key: "marketCapitalization", label: "Market cap", group: "profile", fmt: "usd_m", from: "profile" },
  { key: "shareOutstanding", label: "Shares outstanding", group: "profile", fmt: "count_m", from: "profile" },
  { key: "peTTM", label: "P/E (TTM)", group: "valuation", fmt: "ratio", from: "metric" },
  { key: "peNormalizedAnnual", label: "P/E (normalized)", group: "valuation", fmt: "ratio", from: "metric" },
  { key: "psTTM", label: "P/S (TTM)", group: "valuation", fmt: "ratio", from: "metric" },
  { key: "pbQuarterly", label: "P/B", group: "valuation", fmt: "ratio", from: "metric" },
  { key: "epsTTM", label: "EPS (TTM)", group: "valuation", fmt: "ratio", from: "metric" },
  { key: "roeTTM", label: "ROE (TTM)", group: "valuation", fmt: "pct", from: "metric" },
  { key: "dividendYieldIndicatedAnnual", label: "Dividend yield", group: "valuation", fmt: "pct", from: "metric" },
  { key: "52WeekHigh", label: "52-week high", group: "trading", fmt: "price", from: "metric" },
  { key: "52WeekLow", label: "52-week low", group: "trading", fmt: "price", from: "metric" },
  { key: "beta", label: "Beta", group: "trading", fmt: "ratio", from: "metric" },
  { key: "10DayAverageTradingVolume", label: "Avg volume (10d)", group: "trading", fmt: "count_m", from: "metric" },
];

function keyStatRecords(
  profile: Record<string, unknown>,
  metric: Record<string, unknown>,
  asOf: number,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const f of STAT_FIELDS) {
    const raw = (f.from === "profile" ? profile : metric)[f.key];
    const value = fmtStat(f.fmt, raw);
    if (value === undefined) continue;
    out.push({ field: f.key, label: f.label, value, as_of: asOf, group: f.group });
  }
  return out;
}

function newsRecords(rows: readonly FinnhubNews[], entity: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const it of rows) {
    if (typeof it.datetime !== "number" || !it.headline) continue;
    out.push({
      id: String(it.id ?? it.url ?? `${it.datetime}:${it.headline}`),
      published_at: it.datetime * 1000,
      source: it.source || "finnhub",
      headline: it.headline,
      summary: it.summary || undefined,
      url: it.url || undefined,
      tickers: it.related || entity.toUpperCase(),
      image_url: it.image || undefined,
      sentiment: undefined,
    });
  }
  return out;
}

/**
 * Upcoming/scheduled earnings (calendar endpoint) — keyed off the report date. Each
 * report yields up to two PIT events sharing the reference period: `-EPS` and `-REV`
 * (revenue), each carrying its own forecast/actual. Revenue rows are emitted only when
 * the payload has a revenue estimate or actual.
 */
function earningsRecords(rows: readonly FinnhubEarning[], entity: string, asOf: number): Record<string, unknown>[] {
  const sym = entity.toUpperCase();
  const out: Record<string, unknown>[] = [];
  for (const e of rows) {
    if (!e.date) continue;
    const release = Date.parse(`${e.date}T12:00:00Z`);
    if (!Number.isFinite(release)) continue;
    const ref = refPeriod(e.year, e.quarter, e.date);
    const eps = num(e.epsActual);
    out.push({
      event: `${sym}-EPS`,
      name: `${sym} EPS`,
      reference_period: ref,
      as_of: asOf,
      release_time: release,
      status: eps !== undefined ? "released" : "scheduled",
      forecast: num(e.epsEstimate),
      actual: eps,
      previous: undefined,
      unit: "EPS",
      importance: "high",
    });
    const revActual = num(e.revenueActual);
    const revForecast = num(e.revenueEstimate);
    if (revActual !== undefined || revForecast !== undefined) {
      out.push({
        event: `${sym}-REV`,
        name: `${sym} revenue`,
        reference_period: ref,
        as_of: asOf,
        release_time: release,
        status: revActual !== undefined ? "released" : "scheduled",
        forecast: revForecast,
        actual: revActual,
        previous: undefined,
        unit: "USD",
        importance: "high",
      });
    }
  }
  return out;
}

/** Historical earnings surprises (stock/earnings endpoint) — the est-vs-actual history. */
function surpriseRecords(rows: readonly FinnhubSurprise[], entity: string, asOf: number): Record<string, unknown>[] {
  const sym = entity.toUpperCase();
  const out: Record<string, unknown>[] = [];
  for (const e of rows) {
    if (!e.period) continue;
    const release = Date.parse(`${e.period}T12:00:00Z`);
    if (!Number.isFinite(release)) continue;
    const actual = num(e.actual);
    out.push({
      event: `${sym}-EPS`,
      name: `${sym} EPS`,
      reference_period: refPeriod(e.year, e.quarter, e.period),
      as_of: asOf,
      release_time: release,
      status: actual !== undefined ? "released" : "scheduled",
      forecast: num(e.estimate),
      actual,
      previous: undefined,
      unit: "EPS",
      importance: "high",
    });
  }
  return out;
}

export function createFinnhubResource(deps: { fetchJson?: FetchJson; apiKey?: string } = {}): Resource {
  const fetchJson = deps.fetchJson ?? realFetchJson;
  const key = (): string | undefined => deps.apiKey ?? process.env["FINNHUB_API_KEY"];

  const manifest: ResourceManifest = {
    id: "finnhub",
    shapes: ["news", "releases", "key_stats"],
    params: [
      { name: "shape", required: true, description: "news | releases | key_stats" },
      { name: "entity", required: true, description: "ticker symbol, e.g. AMZN" },
      { name: "kind", required: false, description: "news namespace (company news is always 'ticker')" },
    ],
    configSchema: ["FINNHUB_API_KEY"],
    cadence: { everyMs: 10 * 60_000 },
  };

  return {
    manifest,
    isConfigured: () => Boolean(key()),
    async fetch(params: FetchParams, ctx: FetchContext): Promise<FetchResult> {
      const token = key();
      if (!token) throw new MuErrorException("NOT_CONFIGURED", "finnhub: FINNHUB_API_KEY is not set");
      const entity = params.entity;
      const now = ctx.now();

      if (params.shape === "news") {
        const from = ymd(now - 7 * DAY_MS);
        const to = ymd(now);
        const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(entity)}&from=${from}&to=${to}&token=${token}`;
        const raw = assertOk(await fetchJson(url)) as FinnhubNews[];
        const payload = newsRecords(Array.isArray(raw) ? raw : [], entity);
        // Finnhub company-news is per-ticker, so the namespace is always `ticker`
        // (carried as tail[0]). `kind` is accepted for surface symmetry but ignored.
        return {
          descriptor: { shape: "news", identity: { provider: "finnhub", shape: "news", entity, tail: ["ticker"] }, queryParams: { entity, kind: "ticker" } },
          provenance: { source: "finnhub", fetchedAt: now, trigger: ctx.trigger, queryParams: { entity, kind: "ticker" }, upstream: { from, to } },
          payload,
        };
      }

      if (params.shape === "releases") {
        const enc = encodeURIComponent(entity);
        // Two endpoints: stock/earnings is the est-vs-actual *history* (several past
        // quarters on the free tier); calendar/earnings is the *upcoming* scheduled
        // report. Together they give past actuals + the next estimate.
        const from = ymd(now - 7 * DAY_MS);
        const to = ymd(now + 180 * DAY_MS);
        const histUrl = `https://finnhub.io/api/v1/stock/earnings?symbol=${enc}&limit=40&token=${token}`;
        const calUrl = `https://finnhub.io/api/v1/calendar/earnings?symbol=${enc}&from=${from}&to=${to}&token=${token}`;
        const [histRaw, calRaw] = await Promise.all([
          fetchJson(histUrl).then(assertOk) as Promise<FinnhubSurprise[]>,
          fetchJson(calUrl).then(assertOk) as Promise<{ earningsCalendar?: FinnhubEarning[] }>,
        ]);
        const hist = surpriseRecords(Array.isArray(histRaw) ? histRaw : [], entity, now);
        const cal = earningsRecords(calRaw?.earningsCalendar ?? [], entity, now);
        // dedupe per (event, reference_period) — a period now carries both an EPS and a
        // revenue event — preferring a row that already has an actual.
        const byRef = new Map<string, Record<string, unknown>>();
        for (const r of [...cal, ...hist]) {
          const k = `${r["event"] as string}|${r["reference_period"] as string}`;
          const prev = byRef.get(k);
          if (!prev || (r["actual"] !== undefined && prev["actual"] === undefined)) byRef.set(k, r);
        }
        const payload = withPrevious([...byRef.values()]);
        return {
          descriptor: { shape: "releases", identity: { provider: "finnhub", shape: "releases", entity, tail: [] }, queryParams: { entity } },
          provenance: { source: "finnhub", fetchedAt: now, trigger: ctx.trigger, queryParams: { entity }, upstream: { from, to } },
          payload,
        };
      }

      if (params.shape === "key_stats") {
        const enc = encodeURIComponent(entity);
        // Two endpoints: profile2 (identity: name, sector, market cap, shares) and
        // metric=all (valuation + trading stats). Combined into one tall snapshot.
        const profUrl = `https://finnhub.io/api/v1/stock/profile2?symbol=${enc}&token=${token}`;
        const metricUrl = `https://finnhub.io/api/v1/stock/metric?symbol=${enc}&metric=all&token=${token}`;
        const [profRaw, metricRaw] = await Promise.all([
          fetchJson(profUrl) as Promise<Record<string, unknown>>,
          fetchJson(metricUrl) as Promise<{ metric?: Record<string, unknown> }>,
        ]);
        const payload = keyStatRecords(profRaw ?? {}, metricRaw?.metric ?? {}, now);
        return {
          descriptor: { shape: "key_stats", identity: { provider: "finnhub", shape: "key_stats", entity, tail: [] }, queryParams: { entity } },
          provenance: { source: "finnhub", fetchedAt: now, trigger: ctx.trigger, queryParams: { entity } },
          payload,
        };
      }

      throw new MuErrorException("UNKNOWN_SOURCE", `finnhub does not produce shape '${params.shape}'`);
    },
  };
}

export const resource = createFinnhubResource();
export default resource;
