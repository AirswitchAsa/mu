import { useCallback, useRef, useState } from "react";
import { relAgo } from "../../lib/timefmt";
import { NEWS_FEED, type NewsItem } from "./sampleData";

// =============================================================================
// µ — news wire card. A scrolling headline feed: source · timestamp · tickers,
// sentence-case headline, optional monochrome thumbnail with a sentiment spark.
// v0 renders a baked sample wire (looped to fake an "infinite" stream); a live
// `news` data plane is deferred — see ui/cards/sampleData.ts.
// =============================================================================

function NewsThumb({ label, kind }: { label: string; kind?: NewsItem["kind"] }): JSX.Element {
  const d =
    kind === "down"
      ? "M0 6 L16 11 L32 9 L48 18 L64 20"
      : kind === "up"
        ? "M0 19 L16 14 L32 16 L48 7 L64 4"
        : "M0 12 L16 9 L32 14 L48 10 L64 12";
  return (
    <div className="mu-news__thumb" data-kind={kind ?? "flat"} aria-hidden="true">
      <span className="mu-news__thumblabel">{label}</span>
      <svg className="mu-news__spark" viewBox="0 0 64 24" preserveAspectRatio="none">
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function NewsRow({ item }: { item: NewsItem }): JSX.Element {
  return (
    <article className="mu-news__item">
      {item.thumb && <NewsThumb label={item.thumb} kind={item.kind} />}
      <div className="mu-news__col">
        <div className="mu-news__meta">
          <span className="mu-news__src">{item.source}</span>
          <span className="ds-dot" />
          <span className="mu-news__time">{relAgo(item.mins)}</span>
          {item.tickers.map((t) => (
            <span key={t} className="mu-news__tick">
              {t}
            </span>
          ))}
        </div>
        <h4 className="mu-news__head">{item.headline}</h4>
        {item.summary && <p className="mu-news__sum">{item.summary}</p>}
      </div>
    </article>
  );
}

const MAX_ITEMS = 60;

export function NewsCard(): JSX.Element {
  const [count, setCount] = useState(NEWS_FEED.length);
  const scrollRef = useRef<HTMLDivElement>(null);

  // loop the seed feed as the user nears the bottom → an endless-feeling wire.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      setCount((c) => Math.min(MAX_ITEMS, c + NEWS_FEED.length));
    }
  }, []);

  const items: (NewsItem & { _k: string })[] = [];
  for (let i = 0; i < count; i++) {
    const base = NEWS_FEED[i % NEWS_FEED.length]!;
    const loop = Math.floor(i / NEWS_FEED.length); // shift repeats older
    items.push({ ...base, mins: base.mins + loop * 540, _k: `${base.id}:${i}` });
  }

  return (
    <div className="mu-news">
      <div className="mu-news__bar">
        <span className="mu-news__live ds-spec">
          <span className="ds-dot" />
          live
        </span>
        <span className="ds-spec">{count} headlines</span>
      </div>
      <div className="mu-news__list" ref={scrollRef} onScroll={onScroll}>
        {items.map((it) => (
          <NewsRow key={it._k} item={it} />
        ))}
        {count < MAX_ITEMS && (
          <div className="mu-news__more ds-spec">
            <span className="ds-loading__dot" />
            loading wire
          </div>
        )}
      </div>
    </div>
  );
}
