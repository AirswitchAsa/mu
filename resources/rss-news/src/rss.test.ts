import { describe, expect, it } from "vitest";
import { parseRss, stripHtml } from "./rss.js";
import { createCnbcNews, createYahooNews } from "./index.js";

// =============================================================================
// RSS parsing + `news` normalization (offline; fetchText is injected). Proves the
// tolerant parser and the canonical mapping (id/published_at/source/tickers).
// =============================================================================

const FEED = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Amazon beats on earnings</title>
    <link>https://example.com/1</link>
    <guid>g1</guid>
    <pubDate>Mon, 01 Jun 2026 12:00:00 GMT</pubDate>
    <description><![CDATA[<p>AWS demand &amp; margins strong.</p>]]></description>
  </item>
  <item>
    <title>Undated item is dropped</title>
    <link>https://example.com/2</link>
  </item>
</channel></rss>`;

const ctx = { trigger: "on_demand" as const, now: () => Date.UTC(2026, 5, 1) };

describe("parseRss", () => {
  it("extracts items and unwraps CDATA/entities", () => {
    const items = parseRss(FEED);
    expect(items).toHaveLength(2);
    expect(items[0]!.title).toBe("Amazon beats on earnings");
    expect(items[0]!.guid).toBe("g1");
    expect(stripHtml(items[0]!.description)).toBe("AWS demand & margins strong.");
  });
});

describe("yahoo news resource", () => {
  it("normalizes RSS to canonical news rows and drops undated items", async () => {
    const r = createYahooNews({ fetchText: async () => FEED });
    const out = await r.fetch({ shape: "news", entity: "amzn" }, ctx);
    expect(out.descriptor.identity).toMatchObject({ provider: "yahoo", shape: "news", entity: "amzn" });
    expect(out.payload).toHaveLength(1); // undated item dropped (tolerant)
    expect(out.payload[0]).toMatchObject({
      id: "g1",
      source: "yahoo finance",
      tickers: "AMZN",
      headline: "Amazon beats on earnings",
      published_at: Date.parse("Mon, 01 Jun 2026 12:00:00 GMT"),
    });
  });
});

describe("cnbc news resource", () => {
  it("is a no-key general wire (entity = feed slug, no ticker tag)", async () => {
    const r = createCnbcNews({ fetchText: async () => FEED });
    expect(r.manifest.id).toBe("cnbc");
    expect(r.manifest.configSchema ?? []).toHaveLength(0); // no key
    const out = await r.fetch({ shape: "news", entity: "markets" }, ctx);
    expect(out.payload[0]).toMatchObject({ source: "cnbc", tickers: undefined });
  });
});
