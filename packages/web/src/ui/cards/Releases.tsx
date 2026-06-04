import { Fragment } from "react";
import { fmtValue, latestVintages, nextRelease } from "../../lib/cards";
import { whenLabel } from "../../lib/timefmt";
import type { ReleaseRow } from "../../lib/types";

// =============================================================================
// µ — point-in-time release calendar card. Over one or more bound `releases`
// handles: the latest-known vintage per release (client "as of now"), ordered by
// release time, a NOW divider splitting past from upcoming, status dots, and
// actual vs forecast (numeric, with surprise direction). Reads resolved rows.
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

function ReleaseRowView({ r, now }: { r: ReleaseRow; now: number }): JSX.Element {
  const past = r.release_time < now;
  return (
    <div className="mu-rel__row" data-status={r.status} data-imp={r.importance ?? "med"}>
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
          <span className={`mu-reltag mu-reltag--${r.status}`}>{STATUS_LABEL[r.status]}</span>
        </div>
        <div className="mu-rel__sub">
          {past && r.actual !== undefined ? (
            <span className="mu-rel__vals" data-surprise={surprise(r)}>
              <span className="mu-rel__actual">{fmtValue(r.actual, r.unit)}</span>
              {r.forecast !== undefined && <span className="mu-rel__fc">· est {fmtValue(r.forecast, r.unit)}</span>}
            </span>
          ) : (
            <span className="mu-rel__vals">
              <span className="mu-rel__fc">{r.forecast !== undefined ? `est ${fmtValue(r.forecast, r.unit)}` : "—"}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReleasesCard({ rows, now }: { rows: ReleaseRow[]; now: number }): JSX.Element {
  const calendar = latestVintages(rows); // newest-first
  // upcoming sit above the NOW divider, past below it.
  const firstPastIdx = calendar.findIndex((r) => r.release_time < now);
  const next = nextRelease(calendar, now);

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
          <div className="mu-rel__row ds-spec">no releases yet — bind a calendar and refresh</div>
        )}
        {calendar.map((r, i) => (
          <Fragment key={`${r.event}:${r.reference_period}`}>
            {i === firstPastIdx && (
              <div className="mu-rel__nowmark">
                <span className="ds-spec">now</span>
              </div>
            )}
            <ReleaseRowView r={r} now={now} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}
