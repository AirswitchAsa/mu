import { describe, expect, it } from "vitest";
import { fmtValue, latestSnapshot, latestVintages, mergeKey, mergeNews, newsKey, nextRelease, normalizeUrl, splitTickers } from "./cards";
import type { KeyStatsRow, NewsRow, ReleaseRow } from "./types";

const stat = (field: string, asOf: number, group: string, value = "x"): KeyStatsRow => ({
  field,
  label: field,
  value,
  as_of: asOf,
  group,
});

const news = (id: string, source: string, t: number, extra: Partial<NewsRow> = {}): NewsRow => ({
  id,
  source,
  published_at: t,
  headline: `${source}:${id}`,
  ...extra,
});
const rel = (event: string, ref: string, asOf: number, releaseTime: number, extra: Partial<ReleaseRow> = {}): ReleaseRow => ({
  event,
  name: event,
  reference_period: ref,
  as_of: asOf,
  release_time: releaseTime,
  status: "released",
  ...extra,
});

describe("splitTickers", () => {
  it("splits a comma-joined field and drops blanks", () => {
    expect(splitTickers("AMZN, MSFT ,")).toEqual(["AMZN", "MSFT"]);
    expect(splitTickers(undefined)).toEqual([]);
    expect(splitTickers("")).toEqual([]);
  });
});

describe("normalizeUrl", () => {
  it("lowercases host, drops scheme, strips query + fragment + trailing slash", () => {
    expect(normalizeUrl("https://Example.com/Story/?utm_source=cnbc&x=1#top")).toBe("example.com/Story");
    expect(normalizeUrl("http://example.com/a/b/")).toBe("example.com/a/b");
    expect(normalizeUrl("https://example.com/")).toBe("example.com");
  });

  it("collapses tracking-only variants of the same link to one key", () => {
    const a = normalizeUrl("https://reuters.com/markets/aws?utm_medium=social");
    const b = normalizeUrl("http://reuters.com/markets/aws#ref");
    expect(a).toBe(b);
  });

  it("path case is preserved (paths are case-sensitive) but host case is not", () => {
    expect(normalizeUrl("https://NEWS.Site.com/AB")).toBe("news.site.com/AB");
  });

  it("lightly normalizes a non-parseable string instead of throwing", () => {
    expect(normalizeUrl("Example.com/x/?a=1#f")).toBe("example.com/x");
  });
});

describe("mergeNews", () => {
  it("interleaves handles reverse-chronologically", () => {
    const a = [news("1", "yahoo", 30), news("2", "yahoo", 10)];
    const b = [news("9", "cnbc", 20)];
    expect(mergeNews([a, b]).map((r) => r.id)).toEqual(["1", "9", "2"]);
  });

  it("collapses the SAME story across sources (normalized url) into one row", () => {
    const a = [news("1", "yahoo", 30, { url: "https://wire.com/story?utm_source=y" })];
    const b = [news("9", "cnbc", 30, { url: "http://wire.com/story#frag" })]; // same normalized url
    const out = mergeNews([a, b]);
    expect(out).toHaveLength(1);
  });

  it("keeps the richest-metadata copy on a cross-source collision (image, then summary)", () => {
    const plain = news("1", "yahoo", 30, { url: "https://wire.com/s" });
    const rich = news("9", "cnbc", 30, { url: "https://wire.com/s", image_url: "img", summary: "long" });
    expect(mergeNews([[plain], [rich]])[0]!.source).toBe("cnbc"); // rich wins regardless of order
    expect(mergeNews([[rich], [plain]])[0]!.source).toBe("cnbc");
  });

  it("ties-breaks by longer summary when neither has an image, else keeps earliest-seen", () => {
    const short = news("1", "yahoo", 30, { url: "https://wire.com/s", summary: "hi" });
    const long = news("9", "cnbc", 30, { url: "https://wire.com/s", summary: "much longer summary" });
    expect(mergeNews([[short], [long]])[0]!.source).toBe("cnbc"); // longer summary wins
    // equal richness → earliest-seen stays
    const e1 = news("1", "yahoo", 30, { url: "https://wire.com/s" });
    const e2 = news("9", "cnbc", 30, { url: "https://wire.com/s" });
    expect(mergeNews([[e1], [e2]])[0]!.source).toBe("yahoo");
  });

  it("never merges url-less items: they fall back to within-source (source, id) identity", () => {
    const a = [news("1", "yahoo", 30)]; // no url
    const b = [news("1", "cnbc", 30)]; // same id, different source, no url → both kept
    const out = mergeNews([a, b]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.source).sort()).toEqual(["cnbc", "yahoo"]);
  });

  it("still de-dups exact within-source duplicates", () => {
    const a = [news("1", "yahoo", 30), news("1", "yahoo", 30)]; // dup id+source, no url
    expect(mergeNews([a, []])).toHaveLength(1);
  });

  it("mergeKey is the single dedup + React-list identity (url when present, else source/id)", () => {
    // same normalized url → same key across sources
    const x = news("1", "yahoo", 30, { url: "https://wire.com/s?utm=1" });
    const y = news("9", "cnbc", 30, { url: "http://wire.com/s#a" });
    expect(mergeKey(x)).toBe(mergeKey(y));
    // url-less rows fall back to newsKey, distinct per source
    expect(mergeKey(news("7", "yahoo", 1))).toBe(`id:${newsKey({ source: "yahoo", id: "7" })}`);
    expect(mergeKey(news("7", "yahoo", 1))).not.toBe(mergeKey(news("7", "cnbc", 1)));
  });
});

describe("latestVintages", () => {
  it("keeps the latest-known vintage per (event, reference) and orders newest-first", () => {
    const rows = [
      rel("AMZN-EPS", "2026 Q1", 100, 5000, { status: "scheduled", forecast: 0.98 }),
      rel("AMZN-EPS", "2026 Q1", 200, 5000, { status: "released", forecast: 0.98, actual: 1.12 }),
      rel("GDP", "2026-01-01", 50, 1000, { actual: 2.4 }),
    ];
    const out = latestVintages(rows);
    expect(out).toHaveLength(2); // one per logical release
    expect(out.map((r) => r.event)).toEqual(["AMZN-EPS", "GDP"]); // newest release_time first
    const eps = out.find((r) => r.event === "AMZN-EPS")!;
    expect(eps.as_of).toBe(200); // latest vintage won
    expect(eps.actual).toBe(1.12);
  });
});

describe("nextRelease", () => {
  it("returns the soonest future release by release_time", () => {
    const now = 1000;
    const rows = [rel("A", "p", 1, 500), rel("B", "p", 1, 1500), rel("C", "p", 1, 1200)];
    expect(nextRelease(rows, now)!.event).toBe("C");
    expect(nextRelease([rel("A", "p", 1, 500)], now)).toBeNull();
  });
});

describe("fmtValue", () => {
  it("formats numbers with a unit, and — when absent", () => {
    expect(fmtValue(1.12)).toBe("1.12");
    expect(fmtValue(219000)).toBe("219000");
    expect(fmtValue(3.1, "%")).toBe("3.10%");
    expect(fmtValue(undefined)).toBe("—");
  });

  it("formats USD compactly (B/T)", () => {
    expect(fmtValue(1.34e11, "USD")).toBe("$134.0B");
    expect(fmtValue(2.1e12, "USD")).toBe("$2.10T");
    expect(fmtValue(5.2e6, "USD")).toBe("$5.2M");
  });
});

describe("latestSnapshot", () => {
  it("keeps only the newest vintage and orders profile · valuation · trading", () => {
    const rows = [
      stat("beta", 100, "trading"),
      stat("peTTM", 100, "valuation"),
      stat("sector", 100, "profile"),
      stat("peTTM", 50, "valuation", "stale"), // older vintage — dropped
    ];
    const out = latestSnapshot(rows);
    expect(out).toHaveLength(3); // only as_of=100 vintage
    expect(out.map((r) => r.group)).toEqual(["profile", "valuation", "trading"]);
    expect(out.find((r) => r.field === "peTTM")!.value).not.toBe("stale");
  });

  it("returns [] for no rows", () => {
    expect(latestSnapshot([])).toEqual([]);
  });
});
