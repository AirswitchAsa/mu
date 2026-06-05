import type { KeyStatsRow, NewsRow, ReleaseRow } from "./types";

// =============================================================================
// µ — pure shaping for the news + releases cards (headless-testable). The merger
// owns correctness server-side; these are just presentation transforms over the
// already-resolved rows: interleave a wire by time, and pick the latest known
// vintage per release (the client-side "as of now" view), plus the full revision
// trail per release for the drill-down (the broker now serves every vintage).
// =============================================================================

/** Split a comma-joined ticker field into trimmed, non-empty symbols. */
export function splitTickers(tickers: string | undefined): string[] {
  if (!tickers) return [];
  return tickers.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * The within-source identity of a news item — `(source, id)`. Used as the fallback
 * dedup/list key for items that carry NO url (so a missing url never collapses to
 * empty), and as the React list key when a row wasn't matched by url. See
 * {@link mergeKey} for the single source of truth the card must reuse.
 */
export function newsKey(r: { source: string; id: string }): string {
  return `${r.source} ${r.id}`;
}

/**
 * Normalize a url to a cross-source story key: lowercase host, drop the scheme, strip
 * ALL query params (UTM/tracking and otherwise — they don't identify the article) and
 * the fragment, and drop a trailing slash. Two outlets syndicating the same canonical
 * link therefore collapse to one key. A non-parseable string is lightly normalized
 * (trimmed, lowercased, scheme/fragment/query/trailing-slash stripped) so it still
 * dedups deterministically rather than throwing.
 */
export function normalizeUrl(url: string): string {
  const stripScheme = (s: string): string => s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  try {
    const u = new URL(url);
    const host = u.host.toLowerCase();
    const path = u.pathname.replace(/\/+$/, ""); // drop trailing slash(es)
    return `${host}${path}`; // scheme, search (query), and hash all dropped
  } catch {
    let s = url.trim().toLowerCase();
    s = stripScheme(s);
    s = s.split("#")[0]!.split("?")[0]!; // drop fragment then query
    return s.replace(/\/+$/, "");
  }
}

/**
 * The dedup + React-list identity of a merged news row — the single source of truth
 * so {@link mergeNews} and the News card can't drift (the discipline `newsKey` used
 * to hold alone). A row WITH a url keys by its normalized url (so the same story across
 * sources is one row); a row WITHOUT a url falls back to its within-source `newsKey`.
 */
export function mergeKey(r: NewsRow): string {
  return r.url ? `url:${normalizeUrl(r.url)}` : `id:${newsKey(r)}`;
}

/** True when `cand` carries richer display metadata than `cur` (image, then summary). */
function richerThan(cand: NewsRow, cur: NewsRow): boolean {
  const candImg = Boolean(cand.image_url);
  const curImg = Boolean(cur.image_url);
  if (candImg !== curImg) return candImg; // prefer a copy that has an image
  return (cand.summary?.length ?? 0) > (cur.summary?.length ?? 0); // then a longer summary
}

/**
 * Interleave the rows of several bound `news` handles into one reverse-chronological
 * wire, COLLAPSING the same story carried by different sources into a single row.
 * Identity is {@link mergeKey}: a normalized url when present (so cross-source
 * syndications dedup), else the within-source `newsKey` (a url-less item is never
 * merged into another). On a collision we KEEP THE RICHEST-METADATA copy — one with an
 * `image_url`, tie-broken by the longer `summary`, then the earliest-seen (stable).
 * This reverses the prior "show each labeled source" contract.
 *
 * Normalization lives client-side (presentation-first, no schema churn); a server-side
 * merge on a stored `normalized_url` is a possible future optimization.
 */
export function mergeNews(perHandle: readonly NewsRow[][]): NewsRow[] {
  const byKey = new Map<string, NewsRow>();
  for (const rows of perHandle) {
    for (const r of rows) {
      const k = mergeKey(r);
      const cur = byKey.get(k);
      if (!cur) byKey.set(k, r);
      else if (richerThan(r, cur)) byKey.set(k, r); // upgrade to the richer copy
      // else keep the earliest-seen (stable tie-break)
    }
  }
  return [...byKey.values()].sort((a, b) => b.published_at - a.published_at);
}

/** The logical identity of a release — `(event, reference_period)`; vintages share it. */
export function vintageKey(r: ReleaseRow): string {
  return `${r.event} ${r.reference_period}`;
}

/**
 * Group every resolved vintage by logical release, each trail ordered oldest→newest
 * (by `as_of`). This is the revision history the broker now serves in full (no slice);
 * the card shows the latest vintage by default and expands a row to its trail.
 */
export function releaseTrails(rows: readonly ReleaseRow[]): Map<string, ReleaseRow[]> {
  const m = new Map<string, ReleaseRow[]>();
  for (const r of rows) {
    const k = vintageKey(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  for (const list of m.values()) list.sort((a, b) => a.as_of - b.as_of);
  return m;
}

/**
 * The point-in-time "as of now" view: for each logical release
 * `(event, reference_period)`, keep the latest-known vintage (max `as_of`), then
 * order the calendar **newest-first** by `release_time` (most recent / upcoming on
 * top, history below). This is the client mirror of the broker's as-of read — the
 * card shows what is currently known, revisions collapsing to the newest print.
 */
export function latestVintages(rows: readonly ReleaseRow[]): ReleaseRow[] {
  const best = new Map<string, ReleaseRow>();
  for (const r of rows) {
    const k = vintageKey(r);
    const cur = best.get(k);
    if (!cur || r.as_of > cur.as_of) best.set(k, r);
  }
  return [...best.values()].sort((a, b) => b.release_time - a.release_time);
}

/** The next upcoming release (smallest future `release_time`), or null. */
export function nextRelease(rows: readonly ReleaseRow[], now: number): ReleaseRow | null {
  const up = rows.filter((r) => r.release_time > now).sort((a, b) => a.release_time - b.release_time);
  return up[0] ?? null;
}

/**
 * The cross-section "as of now" view: keep only the newest vintage (max `as_of`),
 * then return its rows in a stable group order (profile · valuation · trading), so
 * the panel renders deterministically. The client mirror of the broker's as-of read.
 */
const STAT_GROUP_ORDER: Record<string, number> = { profile: 0, valuation: 1, trading: 2 };

export function latestSnapshot(rows: readonly KeyStatsRow[]): KeyStatsRow[] {
  if (rows.length === 0) return [];
  const maxAsOf = rows.reduce((m, r) => (r.as_of > m ? r.as_of : m), rows[0]!.as_of);
  const latest = rows.filter((r) => r.as_of === maxAsOf);
  return latest
    .map((r, i) => [r, i] as const)
    .sort(([a, ia], [b, ib]) => {
      const ga = STAT_GROUP_ORDER[a.group ?? ""] ?? 99;
      const gb = STAT_GROUP_ORDER[b.group ?? ""] ?? 99;
      return ga !== gb ? ga - gb : ia - ib; // stable within a group (fetch order)
    })
    .map(([r]) => r);
}

/** Compact currency: 1.34e11 → "$134.0B", 5.2e6 → "$5.2M". */
function fmtCurrency(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

/** Format a release value with its unit ("1.12", "52.1", "+0.4%", "$134.0B"); "—" if absent. */
export function fmtValue(v: number | undefined, unit?: string): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "—";
  if (unit === "USD") return fmtCurrency(v);
  const n = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
  if (unit === "%") return `${n}%`;
  return n;
}
