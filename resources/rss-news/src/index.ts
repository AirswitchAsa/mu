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

/** A feed body carries one of these; an error/HTML page (served with HTTP 200) does not. */
function looksLikeFeed(body: string): boolean {
  const head = body.slice(0, 4096).toLowerCase();
  return head.includes("<rss") || head.includes("<feed") || head.includes("<item") || head.includes("<entry");
}

// --- News namespace taxonomy (carried as the handle tail[0]) -----------------
// Three scopes the agent can request and a card can group/badge by. Encoded as
// `provider:news:<entity>:<namespace>` so the wire's scope is part of its identity
// (data-architecture.md §3 — the tail is a shape-specific remainder). An existing
// handle with an empty tail still resolves: consumers treat a missing namespace as
// the resource's default (per-ticker→ticker, general wire→market).
export type NewsNamespace = "ticker" | "sector" | "market";
const NAMESPACES: readonly NewsNamespace[] = ["ticker", "sector", "market"];
const isNamespace = (v: unknown): v is NewsNamespace =>
  typeof v === "string" && (NAMESPACES as readonly string[]).includes(v);

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
  /**
   * The default namespace for this feed when the caller omits `kind` (per-ticker
   * feeds → ticker; general wires resolve per-slug). The resolved namespace lands in
   * the handle tail.
   */
  namespaceFor: (entity: string) => NewsNamespace;
}

function rssResource(spec: RssSpec, fetchText: FetchText): Resource {
  const manifest: ResourceManifest = {
    id: spec.id,
    shapes: ["news"],
    params: [
      { name: "entity", required: true, description: spec.paramDesc },
      { name: "kind", required: false, description: "news namespace: ticker | sector | market (defaulted from the feed when omitted)" },
    ],
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
      // An explicit `kind` wins (validated against the taxonomy); otherwise the feed's
      // default. The resolved namespace becomes tail[0] of the handle.
      const namespace: NewsNamespace = isNamespace(params.kind) ? params.kind : spec.namespaceFor(entity);
      const xml = await fetchText(spec.urlFor(entity));
      if (!looksLikeFeed(xml)) {
        // A non-feed body (HTML error page, redirect) returned with HTTP 200 — make the
        // source's brokenness visible instead of silently yielding "no headlines".
        throw new MuErrorException("FETCH_FAILED", `${spec.id}: response was not an RSS/Atom feed`);
      }
      const payload = toNews(parseRss(xml), spec.source, spec.tickersFor(entity));
      return {
        descriptor: {
          shape: "news",
          identity: { provider: spec.id, shape: "news", entity, tail: [namespace] },
          queryParams: { entity, kind: namespace },
        },
        payload,
        provenance: {
          source: spec.id,
          fetchedAt: ctx.now(),
          trigger: ctx.trigger,
          queryParams: { entity, kind: namespace },
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
      namespaceFor: () => "ticker", // per-ticker company headlines
    },
    deps.fetchText ?? realFetchText,
  );
}

// --- CNBC: general/section wires (entity = a feed slug) -----------------------
// Feed ids verified against the live CNBC RSS titles. CNBC has no dedicated "markets"
// feed, so `markets` aliases the Investing wire (closest market coverage); `economy`
// is its own feed (id 20910258 is "Economy", not markets).
const CNBC_FEEDS: Record<string, string> = {
  top: "100003114",
  business: "10001147",
  economy: "20910258",
  finance: "10000664",
  investing: "15839069",
  markets: "15839069", // alias → Investing
  technology: "19854910",
  earnings: "15839135",
};
const CNBC_SLUGS = Object.keys(CNBC_FEEDS).join("|");

// CNBC slug → news namespace. The broad market/macro/finance wires are `market`;
// the narrower verticals/themes are `sector`. (No CNBC wire is per-ticker, so none
// map to `ticker`.) An unknown slug falls back to `top` (→ market), matching the URL
// fallback above. This is the documented mapping for the workstream.
const CNBC_NAMESPACE: Record<string, NewsNamespace> = {
  top: "market",
  markets: "market",
  economy: "market",
  finance: "market",
  investing: "market",
  business: "market",
  technology: "sector",
  earnings: "sector",
};

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
      namespaceFor: (e) => CNBC_NAMESPACE[e.toLowerCase()] ?? "market",
    },
    deps.fetchText ?? realFetchText,
  );
}

export const resources: Resource[] = [createYahooNews(), createCnbcNews()];
export default resources;
