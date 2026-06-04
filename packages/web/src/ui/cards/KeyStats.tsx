import { Fragment } from "react";
import { latestSnapshot } from "../../lib/cards";
import { agoLabel } from "../../lib/timefmt";
import type { KeyStatsRow } from "../../lib/types";

// =============================================================================
// µ — company key-statistics panel (cross-section). Over a bound `key_stats` handle:
// the newest vintage's fields, bucketed into groups (profile · valuation · trading),
// each a reader-friendly label · display-ready value. Reads resolved rows (no baked
// data); "updated {ago}" reflects the snapshot vintage (no streaming).
// =============================================================================

const GROUP_LABEL: Record<string, string> = {
  profile: "Profile",
  valuation: "Valuation",
  trading: "Trading",
};

/** Stable, ordered list of the groups present (latestSnapshot already sorts rows). */
function groupsOf(rows: KeyStatsRow[]): string[] {
  const seen: string[] = [];
  for (const r of rows) {
    const g = r.group ?? "other";
    if (!seen.includes(g)) seen.push(g);
  }
  return seen;
}

export function KeyStatsCard({ rows, now }: { rows: KeyStatsRow[]; now: number }): JSX.Element {
  const snapshot = latestSnapshot(rows);
  const asOf = snapshot.length ? snapshot[0]!.as_of : undefined;
  const groups = groupsOf(snapshot);

  return (
    <div className="mu-stats">
      <div className="mu-stats__bar">
        <span className="mu-stats__updated ds-spec">
          {asOf !== undefined ? `updated ${agoLabel(asOf, now)}` : "no data"}
        </span>
        <span className="ds-spec">{snapshot.length} stats</span>
      </div>
      <div className="mu-stats__list">
        {snapshot.length === 0 ? (
          <div className="mu-stats__empty ds-spec">no stats yet — bind a key_stats handle and refresh</div>
        ) : (
          groups.map((g) => (
            <Fragment key={g}>
              <div className="mu-stats__group ds-spec">{GROUP_LABEL[g] ?? g}</div>
              <dl className="mu-stats__grid">
                {snapshot
                  .filter((r) => (r.group ?? "other") === g)
                  .map((r) => (
                    <div className="mu-stats__row" key={r.field}>
                      <dt className="mu-stats__label">{r.label}</dt>
                      <dd className="mu-stats__value">{r.value}</dd>
                    </div>
                  ))}
              </dl>
            </Fragment>
          ))
        )}
      </div>
    </div>
  );
}
