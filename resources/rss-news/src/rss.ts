// =============================================================================
// µ — a tiny, dependency-free RSS/Atom item parser (tolerant). Pulls the fields a
// `news` record needs out of a feed string. Regex-based on purpose: feeds are
// small and messy, and we never need a full DOM. Pure + exported for unit tests.
// =============================================================================

export interface RssItem {
  title: string;
  link: string;
  guid: string;
  pubDate: string;
  description: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  nbsp: " ",
};

/** Decode the handful of XML/HTML entities that show up in feeds. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-zA-Z#0-9]+);/g, (m, name: string) => ENTITIES[name] ?? m);
}

/** Strip tags + CDATA wrappers and collapse whitespace → plain text. */
export function stripHtml(s: string): string {
  return decodeEntities(
    s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function unwrap(raw: string): string {
  const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return decodeEntities((cdata ? cdata[1]! : raw).trim());
}

/** First `<tag>…</tag>` (or self-closing/href) inner text for a tag, else "". */
function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (m) return unwrap(m[1]!);
  // Atom-style `<link href="…"/>`
  const href = xml.match(new RegExp(`<${name}\\b[^>]*\\bhref=["']([^"']+)["']`, "i"));
  return href ? decodeEntities(href[1]!) : "";
}

/**
 * Parse RSS 2.0 `<item>` and Atom `<entry>` blocks into RssItems. Items missing a
 * title are skipped (nothing to show); everything else is best-effort.
 */
export function parseRss(xml: string): RssItem[] {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  const out: RssItem[] = [];
  for (const block of blocks) {
    const title = tag(block, "title");
    if (!title) continue;
    out.push({
      title,
      link: tag(block, "link"),
      guid: tag(block, "guid") || tag(block, "id"),
      pubDate: tag(block, "pubDate") || tag(block, "published") || tag(block, "updated"),
      description: tag(block, "description") || tag(block, "summary") || tag(block, "content"),
    });
  }
  return out;
}
