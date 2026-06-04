import { describe, expect, it } from "vitest";
import { fmtValue, latestSnapshot, latestVintages, mergeNews, nextRelease, splitTickers } from "./cards";
import type { KeyStatsRow, NewsRow, ReleaseRow } from "./types";

const stat = (field: string, asOf: number, group: string, value = "x"): KeyStatsRow => ({
  field,
  label: field,
  value,
  as_of: asOf,
  group,
});

const news = (id: string, source: string, t: number): NewsRow => ({ id, source, published_at: t, headline: `${source}:${id}` });
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

describe("mergeNews", () => {
  it("interleaves handles reverse-chronologically", () => {
    const a = [news("1", "yahoo", 30), news("2", "yahoo", 10)];
    const b = [news("9", "cnbc", 20)];
    expect(mergeNews([a, b]).map((r) => r.id)).toEqual(["1", "9", "2"]);
  });

  it("keeps each source's copy (no cross-source dedup) but de-dups within a source", () => {
    const a = [news("1", "yahoo", 30), news("1", "yahoo", 30)]; // dup id+source
    const b = [news("1", "cnbc", 30)]; // same id, different source → kept
    const out = mergeNews([a, b]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.source).sort()).toEqual(["cnbc", "yahoo"]);
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
