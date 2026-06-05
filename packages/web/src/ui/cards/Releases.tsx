import { Fragment, useState } from "react";
import { fmtValue, latestVintages, nextRelease, releaseTrails, vintageKey } from "../../lib/cards";
import { whenLabel } from "../../lib/timefmt";
import type { ReleaseRow } from "../../lib/types";

// =============================================================================
// µ — point-in-time release calendar card. Over one or more bound `releases`
// handles: the latest-known vintage per release (client "as of now"), ordered by
// release time, a NOW divider splitting past from upcoming, status dots, and
// actual vs forecast. A revised release expands to its full revision TRAIL — every
// vintage (first print → each revision), as the broker now serves all vintages.
// =============================================================================

const STATUS_LABEL: Record<ReleaseRow["status"], string> = {
  released: "released",
  revised: "revised",
  scheduled: "scheduled",
};

/** beat (+1) / miss (−1) / flat (0) of actual vs forecast, for coloring. */
function surprise(r: ReleaseRow): 1 | -1 | 0 {
  if (r.actual === undefined || r.forecast === undefined) return 0;
  if (r.actual > r.forecast) return 1;
  if (r.actual < r.forecast) return -1;
  return 0;
}

const vintageDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The expanded revision trail: every vintage of one release, oldest→newest, with deltas. */
function VintageTrail({ trail }: { trail: ReleaseRow[] }): JSX.Element {
  return (
    <div className="mu-rel__trail">
      {trail.map((v, i) => {
        const prior = i > 0 ? trail[i - 1]!.actual : undefined;
        const delta =
          v.actual !== undefined && prior !== undefined ? v.actual - prior : undefined;
        const dir = delta === undefined || delta === 0 ? 0 : delta > 0 ? 1 : -1;
        return (
          <div className="mu-rel__vrow" key={v.as_of}>
            <span className="mu-rel__vas">{vintageDay(v.as_of)}</span>
            <span className="mu-rel__vtag">{i === 0 ? "first" : "revised"}</span>
            <span className="mu-rel__vval">{fmtValue(v.actual, v.unit)}</span>
            {delta !== undefined && delta !== 0 && (
              <span className="mu-rel__vdelta" data-dir={dir}>
                {delta > 0 ? "+" : ""}
                {fmtValue(delta, v.unit)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReleaseRowView({
  r,
  trail,
  now,
  open,
  onToggle,
}: {
  r: ReleaseRow;
  trail: ReleaseRow[];
  now: number;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  const past = r.release_time < now;
  const revisions = Math.max(0, trail.length - 1);
  const expandable = revisions > 0;
  return (
    <>
      <div
        className="mu-rel__row"
        data-status={r.status}
        data-imp={r.importance ?? "med"}
        data-expandable={expandable || undefined}
        data-open={open || undefined}
        onClick={expandable ? onToggle : undefined}
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        onKeyDown={expandable ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle()) : undefined}
      >
        <div className="mu-rel__when">
          <span className="mu-rel__whenrel">{whenLabel(r.release_time, now)}</span>
          <span className="mu-rel__whenper">{r.reference_period}</span>
        </div>
        <div className="mu-rel__rail">
          <span className="mu-rel__dot" />
        </div>
        <div className="mu-rel__main">
          <div className="mu-rel__top">
            <span className="mu-rel__series">{r.name}</span>
            {expandable ? (
              <button className="mu-rel__revs" aria-expanded={open}>
                {revisions} revision{revisions > 1 ? "s" : ""}
                <span className="mu-rel__chev" data-open={open || undefined}>›</span>
              </button>
            ) : (
              <span className={`mu-reltag mu-reltag--${r.status}`}>{STATUS_LABEL[r.status]}</span>
            )}
          </div>
          <div className="mu-rel__sub">
            {past && r.actual !== undefined ? (
              <span className="mu-rel__vals" data-surprise={surprise(r)}>
                <span className="mu-rel__actual">{fmtValue(r.actual, r.unit)}</span>
                {r.forecast !== undefined ? (
                  <span className="mu-rel__fc">· est {fmtValue(r.forecast, r.unit)}</span>
                ) : r.previous !== undefined ? (
                  <span className="mu-rel__fc">· prev {fmtValue(r.previous, r.unit)}</span>
                ) : null}
              </span>
            ) : (
              <span className="mu-rel__vals">
                <span className="mu-rel__fc">{r.forecast !== undefined ? `est ${fmtValue(r.forecast, r.unit)}` : "—"}</span>
              </span>
            )}
          </div>
          {open && <VintageTrail trail={trail} />}
        </div>
      </div>
    </>
  );
}

export function ReleasesCard({ rows, now }: { rows: ReleaseRow[]; now: number }): JSX.Element {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const trails = releaseTrails(rows);
  const calendar = latestVintages(rows); // newest-first
  // upcoming sit above the NOW divider, past below it.
  const firstPastIdx = calendar.findIndex((r) => r.release_time < now);
  const next = nextRelease(calendar, now);

  const toggle = (k: string): void =>
    setOpen((prev) => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  return (
    <div className="mu-rel">
      <div className="mu-rel__head">
        <span className="ds-spec">next release</span>
        {next && (
          <span className="mu-rel__next">
            <span className="mu-rel__nextname">{next.name}</span>
            <span className="mu-rel__nextin">{whenLabel(next.release_time, now)}</span>
          </span>
        )}
      </div>
      <div className="mu-rel__list">
        {calendar.length === 0 && (
          <div className="mu-rel__row ds-spec">no releases yet — ask µ for a release calendar</div>
        )}
        {calendar.map((r, i) => {
          const k = vintageKey(r);
          return (
            <Fragment key={k}>
              {i === firstPastIdx && (
                <div className="mu-rel__nowmark">
                  <span className="ds-spec">now</span>
                </div>
              )}
              <ReleaseRowView r={r} trail={trails.get(k) ?? [r]} now={now} open={open.has(k)} onToggle={() => toggle(k)} />
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
