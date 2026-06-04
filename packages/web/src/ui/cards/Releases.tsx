import { Fragment } from "react";
import { relWhen } from "../../lib/timefmt";
import { nextRelease, RELEASES, type ReleaseEvent } from "./sampleData";

// =============================================================================
// µ — point-in-time release calendar card. A vintage timeline: the left gutter
// carries the as-of timestamp + reference period, status dots sit on a rail
// (released / revised / scheduled), a NOW divider splits past from upcoming, and
// each past row shows actual vs forecast. v0 renders a baked sample calendar; a
// live point-in-time `releases` data plane is deferred — see ui/cards/sampleData.ts.
// =============================================================================

const STATUS_LABEL: Record<ReleaseEvent["status"], string> = {
  released: "released",
  revised: "revised",
  scheduled: "scheduled",
};

function ReleaseRow({ r }: { r: ReleaseEvent }): JSX.Element {
  const past = r.hrs < 0;
  return (
    <div className="mu-rel__row" data-status={r.status} data-imp={r.imp}>
      <div className="mu-rel__when">
        <span className="mu-rel__whenrel">{relWhen(r.hrs)}</span>
        <span className="mu-rel__whenper">{r.period}</span>
      </div>
      <div className="mu-rel__rail">
        <span className="mu-rel__dot" />
      </div>
      <div className="mu-rel__main">
        <div className="mu-rel__top">
          <span className="mu-rel__series">{r.series}</span>
          <span className={`mu-reltag mu-reltag--${r.status}`}>{STATUS_LABEL[r.status]}</span>
        </div>
        <div className="mu-rel__sub">
          {past ? (
            <span className="mu-rel__vals">
              <span className="mu-rel__actual">{r.actual}</span>
              <span className="mu-rel__fc">· est {r.forecast}</span>
            </span>
          ) : (
            <span className="mu-rel__vals">
              <span className="mu-rel__fc">est {r.forecast}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReleasesCard(): JSX.Element {
  const rows = RELEASES.slice().sort((a, b) => a.hrs - b.hrs);
  const firstFutureIdx = rows.findIndex((r) => r.hrs > 0);
  const next = nextRelease();

  return (
    <div className="mu-rel">
      <div className="mu-rel__head">
        <span className="ds-spec">next release</span>
        {next && (
          <span className="mu-rel__next">
            <span className="mu-rel__nextname">{next.series}</span>
            <span className="mu-rel__nextin">{relWhen(next.hrs)}</span>
          </span>
        )}
      </div>
      <div className="mu-rel__list">
        {rows.map((r, i) => (
          <Fragment key={r.id}>
            {i === firstFutureIdx && (
              <div className="mu-rel__nowmark">
                <span className="ds-spec">now</span>
              </div>
            )}
            <ReleaseRow r={r} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}
