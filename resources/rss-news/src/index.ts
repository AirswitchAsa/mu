import {
  MuErrorException,
  type FetchResult,
  type ResourceManifest,
} from "@mu/protocol";
import type { FetchContext, FetchParams, Resource } from "@mu/resource-sdk";
import { parseRss, stripHtml, type RssItem } from "./rss.js";

// =============================================================================
// µ — no-key `news` resources over RSS. Yahoo Finance carries a per-ticker feed;
// CNBC carries general/section wires. Both normalize to the canonical `news`
// shape, so one card renders any mix of them. `fetchText` is injectable so the
// normalization is unit-tested offline (no network).
// =============================================================================

export type FetchText = (url: string) => Promise<string>;

const UA =
  "Mozilla/5.0 (compatible; mu-research/0.0; +https://github.com/AirswitchAsa/mu)";

const realFetchText: FetchText = async (url) => {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml, */*" } });
  if (!r.ok) throw new MuErrorException("FETCH_FAILED", `HTTP ${r.status} from ${url}`);
  return r.text();
};

const SUMMARY_MAX = 320;

/** RSS items → canonical `news` records for `source`, tagged with `tickers`. */
function toNews(items: readonly RssItem[], source: string, tickers: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const it of items) {
    const published = Date.parse(it.pubDate);
    if (!Number.isFinite(published)) continue; // tolerant: drop undated items
    const headline = stripHtml(it.title);
    if (!headline) continue;
    const id = it.guid || it.link || `${source}:${headline}`;
    const summary = stripHtml(it.description);
    out.push({
      id,
      published_at: published,
      source,
      headline,
      summary: summary ? summary.slice(0, SUMMARY_MAX) : undefined,
      url: it.link || undefined,
      tickers: tickers || undefined,
      image_url: undefined,
      sentiment: undefined,
    });
  }
  return out;
}

interface RssSpec {
  id: string;
  source: string;
  paramDesc: string;
  /** build the feed URL for an entity (ticker or feed slug). */
  urlFor: (entity: string) => string;
  /** the comma-joined tickers to stamp on each item (per-ticker feeds tag themselves). */
  tickersFor: (entity: string) => string;
}

function rssResource(spec: RssSpec, fetchText: FetchText): Resource {
  const manifest: ResourceManifest = {
    id: spec.id,
    shapes: ["news"],
    params: [{ name: "entity", required: true, description: spec.paramDesc }],
    cadence: { everyMs: 5 * 60_000 },
    // no configSchema → always available (no key).
  };
  return {
    manifest,
    async fetch(params: FetchParams, ctx: FetchContext): Promise<FetchResult> {
      if (params.shape !== "news") {
        throw new MuErrorException("UNKNOWN_SOURCE", `${spec.id} does not produce shape '${params.shape}'`);
      }
      const entity = params.entity;
      const xml = await fetchText(spec.urlFor(entity));
      const payload = toNews(parseRss(xml), spec.source, spec.tickersFor(entity));
      return {
        descriptor: {
          shape: "news",
          identity: { provider: spec.id, shape: "news", entity, tail: [] },
          queryParams: { entity },
        },
        payload,
        provenance: {
          source: spec.id,
          fetchedAt: ctx.now(),
          trigger: ctx.trigger,
          queryParams: { entity },
          upstream: { url: spec.urlFor(entity) },
        },
      };
    },
  };
}

// --- Yahoo Finance: a per-ticker headline feed (entity = ticker) -------------
export function createYahooNews(deps: { fetchText?: FetchText } = {}): Resource {
  return rssResource(
    {
      id: "yahoo",
      source: "yahoo finance",
      paramDesc: "ticker symbol, e.g. AMZN — Yahoo Finance per-ticker headlines",
      urlFor: (e) => `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(e)}&region=US&lang=en-US`,
      tickersFor: (e) => e.toUpperCase(),
    },
    deps.fetchText ?? realFetchText,
  );
}

// --- CNBC: general/section wires (entity = a feed slug) -----------------------
const CNBC_FEEDS: Record<string, string> = {
  top: "100003114",
  markets: "20910258",
  business: "10001147",
  economy: "20910258",
  finance: "10000664",
  technology: "19854910",
  earnings: "15839135",
  investing: "15839069",
};
const CNBC_SLUGS = Object.keys(CNBC_FEEDS).join("|");

export function createCnbcNews(deps: { fetchText?: FetchText } = {}): Resource {
  return rssResource(
    {
      id: "cnbc",
      source: "cnbc",
      paramDesc: `CNBC wire (general, not per-ticker): one of ${CNBC_SLUGS} (default top)`,
      urlFor: (e) => {
        const id = CNBC_FEEDS[e.toLowerCase()] ?? CNBC_FEEDS["top"]!;
        return `https://www.cnbc.com/id/${id}/device/rss/rss.html`;
      },
      tickersFor: () => "",
    },
    deps.fetchText ?? realFetchText,
  );
}

export const resources: Resource[] = [createYahooNews(), createCnbcNews()];
export default resources;
