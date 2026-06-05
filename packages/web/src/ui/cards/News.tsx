import { mergeKey, splitTickers } from "../../lib/cards";
import { agoLabel } from "../../lib/timefmt";
import type { NewsRow } from "../../lib/types";

// =============================================================================
// µ — news wire card. A reverse-chronological headline feed over one or more bound
// `news` handles (interleaved + cross-source deduped by the parent via mergeNews):
// source · time · tickers, headline, optional summary. The same story syndicated by
// several sources shows once (richest copy). Reads resolved rows (no baked data).
//
// FUTURE: rows carry no handle, so the namespace (handle tail[0]: ticker|sector|market)
// isn't available here to group/badge by. Badging would mean threading each binding's
// decoded tail down from GridCard onto its rows — deferred (not a cheap change).
// =============================================================================

function NewsRowView({ item, now }: { item: NewsRow; now: number }): JSX.Element {
  const tickers = splitTickers(item.tickers);
  const head = item.url ? (
    <a className="mu-news__headlink" href={item.url} target="_blank" rel="noopener noreferrer">
      {item.headline}
    </a>
  ) : (
    item.headline
  );
  return (
    <article className="mu-news__item">
      <div className="mu-news__col">
        <div className="mu-news__meta">
          <span className="mu-news__src">{item.source}</span>
          <span className="ds-dot" />
          <span className="mu-news__time">{agoLabel(item.published_at, now)}</span>
          {tickers.map((t) => (
            <span key={t} className="mu-news__tick">
              {t}
            </span>
          ))}
        </div>
        <h4 className="mu-news__head">{head}</h4>
        {item.summary && <p className="mu-news__sum">{item.summary}</p>}
      </div>
    </article>
  );
}

export function NewsCard({ items, now }: { items: NewsRow[]; now: number }): JSX.Element {
  // "updated" = the freshness of the wire's content (its newest headline). There is
  // no streaming; the data is as recent as the last fetch/refresh, so the newest item
  // is the honest freshness signal (replaces the old always-on cosmetic "live" badge).
  const newest = items.length ? Math.max(...items.map((it) => it.published_at)) : undefined;
  return (
    <div className="mu-news">
      <div className="mu-news__bar">
        <span className="mu-news__updated ds-spec">
          {newest !== undefined ? `updated ${agoLabel(newest, now)}` : "no data"}
        </span>
        <span className="ds-spec">{items.length} headlines</span>
      </div>
      <div className="mu-news__list">
        {items.length === 0 ? (
          <div className="mu-news__more ds-spec">no headlines yet — bind a news feed and refresh</div>
        ) : (
          items.map((it) => <NewsRowView key={mergeKey(it)} item={it} now={now} />)
        )}
      </div>
    </div>
  );
}
