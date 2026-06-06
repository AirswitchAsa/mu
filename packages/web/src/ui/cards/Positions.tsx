import { agoLabel } from "../../lib/timefmt";
import { fmtQty, fmtSignedPct, fmtSignedUsd, fmtUsd, holdings } from "../../lib/portfolio";
import type { PositionsRow } from "../../lib/types";

// =============================================================================
// µ — brokerage holdings table (cross-section). Over a bound `positions` handle: the
// newest vintage's open positions, sorted by market value, each row P/L-colored, with
// a totals row. Reads resolved rows (no baked data); "updated {ago}" reflects the
// snapshot vintage. Balances ride the key_stats panel; the equity curve rides compare.
// =============================================================================

/** A signed money/percent cell, colored by sign (green up / red down). */
function Pl({ value, kind }: { value: number; kind: "usd" | "pct" }): JSX.Element {
  const dir = value > 0 ? "up" : value < 0 ? "down" : "flat";
  return (
    <span className="mu-holdings__pl" data-dir={dir}>
      {kind === "usd" ? fmtSignedUsd(value) : fmtSignedPct(value)}
    </span>
  );
}

export function PositionsCard({ rows, now }: { rows: PositionsRow[]; now: number }): JSX.Element {
  const { rows: pos, totals } = holdings(rows);
  const asOf = pos.length ? pos[0]!.as_of : undefined;

  return (
    <div className="mu-holdings">
      <div className="mu-holdings__bar">
        <span className="mu-holdings__updated ds-spec">
          {asOf !== undefined ? `updated ${agoLabel(asOf, now)}` : "no data"}
        </span>
        <span className="ds-spec">{pos.length} positions</span>
      </div>
      {pos.length === 0 ? (
        <div className="mu-holdings__empty ds-spec">no open positions — bind a positions handle and refresh</div>
      ) : (
        <div className="mu-holdings__scroll">
          <table className="mu-holdings__table">
            <thead>
              <tr>
                <th className="mu-holdings__sym">Symbol</th>
                <th>Qty</th>
                <th>Avg</th>
                <th>Last</th>
                <th>Mkt Value</th>
                <th>Open P/L</th>
                <th>Day</th>
              </tr>
            </thead>
            <tbody>
              {pos.map((p) => (
                <tr key={p.symbol}>
                  <td className="mu-holdings__sym">
                    {p.symbol}
                    {p.side === "short" && <span className="mu-holdings__short ds-spec">short</span>}
                  </td>
                  <td>{fmtQty(p.qty)}</td>
                  <td>{fmtUsd(p.avg_entry)}</td>
                  <td>{fmtUsd(p.price)}</td>
                  <td>{fmtUsd(p.market_value)}</td>
                  <td>
                    <Pl value={p.unrealized_pl} kind="usd" /> <Pl value={p.unrealized_plpc} kind="pct" />
                  </td>
                  <td>
                    <Pl value={p.change_today} kind="pct" />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="mu-holdings__sym">Total</td>
                <td />
                <td />
                <td />
                <td>{fmtUsd(totals.market_value)}</td>
                <td>
                  <Pl value={totals.unrealized_pl} kind="usd" /> <Pl value={totals.unrealized_plpc} kind="pct" />
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
