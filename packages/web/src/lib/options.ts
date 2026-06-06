// =============================================================================
// µ — pure transforms for the options_chain cross-section, shared by the `grid`
// (calls │ strike │ puts ladder) and `curve` (smile / term structure) renderers.
// Pure + value-based so they unit-test without a DOM (options.test.ts), exactly like
// lib/indicators. The renderers stay thin: fold rows here, draw there.
// =============================================================================

/** A resolved `options_chain` row (one side of one strike for one vintage). */
export interface ChainRow {
  id: string;
  expiry: string;
  strike: number;
  right: "call" | "put";
  bid: number;
  ask: number;
  mid: number;
  iv: number;
  smv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  open_interest: number;
  volume: number;
  underlying: number;
  dte: number;
  as_of: number;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

/** Keep only the newest `as_of` vintage — the card shows the latest snapshot. */
export function latestSnapshot<T extends { as_of: number }>(rows: readonly T[]): T[] {
  if (rows.length === 0) return [];
  let max = -Infinity;
  for (const r of rows) if (r.as_of > max) max = r.as_of;
  return rows.filter((r) => r.as_of === max);
}

/** Distinct expiries, ascending — the selectable tabs. */
export function expiriesOf(rows: readonly ChainRow[]): string[] {
  return [...new Set(rows.map((r) => r.expiry))].sort();
}

export interface LadderRow {
  strike: number;
  call?: ChainRow;
  put?: ChainRow;
}
export interface Ladder {
  expiry: string;
  underlying: number;
  /** the strike nearest the underlying (the ATM row to center + highlight). */
  atmStrike: number;
  rows: LadderRow[];
}

/**
 * Fold one expiry's rows into the canonical calls │ strike │ puts ladder, ascending by
 * strike, with the call and put for each strike paired and the ATM strike marked.
 */
export function chainLadder(rows: readonly ChainRow[], expiry: string): Ladder {
  const inExp = rows.filter((r) => r.expiry === expiry);
  const byStrike = new Map<number, LadderRow>();
  for (const r of inExp) {
    let lr = byStrike.get(r.strike);
    if (!lr) {
      lr = { strike: r.strike };
      byStrike.set(r.strike, lr);
    }
    if (r.right === "call") lr.call = r;
    else lr.put = r;
  }
  const ladder = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  const underlying = inExp[0]?.underlying ?? 0;
  let atmStrike = ladder[0]?.strike ?? 0;
  let best = Infinity;
  for (const lr of ladder) {
    const d = Math.abs(lr.strike - underlying);
    if (d < best) {
      best = d;
      atmStrike = lr.strike;
    }
  }
  return { expiry, underlying, atmStrike, rows: ladder };
}

// --- curve (smile / term structure) -----------------------------------------

export interface CurveSpec {
  /** x-axis column (e.g. `strike` for a smile, `dte` for a term structure). */
  x?: string;
  /** y-axis column(s) (e.g. `iv` / `smv`). */
  y?: string | string[];
  /** split into one curve per distinct value of this column (e.g. `right`). */
  series?: string;
  /**
   * keep only rows matching these column predicates. A scalar is an equality
   * (`{ expiry: "2026-06-19" }`); an object is a numeric range (`{ strike: { min: 240,
   * max: 380 } }`) — used to window a smile to strikes near spot so the illiquid wings
   * don't compress the curve.
   */
  where?: Record<string, unknown>;
  /** reduce each `groupBy` group to one representative row (term structure). */
  reduce?: { groupBy: string; pick?: { column: string; target: string } };
}
export interface CurvePoint {
  x: number;
  y: number;
}
export interface CurveSeriesOut {
  label: string;
  points: CurvePoint[];
}

/** A `where` predicate: a scalar is equality; a `{min?, max?}` object is a numeric range. */
function matchWhere(cell: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object" && !Array.isArray(cond)) {
    const c = cond as { min?: number; max?: number };
    const n = num(cell);
    if (typeof c.min === "number" && !(n >= c.min)) return false;
    if (typeof c.max === "number" && !(n <= c.max)) return false;
    return Number.isFinite(n);
  }
  return cell === cond;
}

const finite = (p: CurvePoint): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);
const byX = (a: CurvePoint, b: CurvePoint): number => a.x - b.x;

function project(rows: readonly Record<string, unknown>[], x: string, yCols: string[], label: (y: string) => string): CurveSeriesOut[] {
  return yCols.map((yc) => ({
    label: label(yc),
    points: rows
      .map((r) => ({ x: num(r[x]), y: num(r[yc]) }))
      .filter(finite)
      .sort(byX),
  }));
}

function groupBy(rows: readonly Record<string, unknown>[], col: string): Map<unknown, Record<string, unknown>[]> {
  const groups = new Map<unknown, Record<string, unknown>[]>();
  for (const r of rows) {
    const k = r[col];
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  return groups;
}

/**
 * Build the xy series a `curve` draws from a cross-section, in two generic modes:
 * - **projection**: `x` vs `y`, optionally split into one series per `series` value and
 *   filtered by `where` — a smile is `x=strike, y=smv, series=right, where={expiry}`.
 * - **reduce**: collapse each `groupBy` group to the row whose `pick.column` is nearest
 *   `pick.target`, then plot `x` vs `y` — a term structure is `groupBy=expiry,
 *   pick={column:strike,target:underlying}, x=dte, y=smv`.
 * Neither mode knows "options" — it is column algebra over rows.
 */
export function curveSeries(rows: readonly Record<string, unknown>[], spec: CurveSpec): CurveSeriesOut[] {
  const x = spec.x ?? "strike";
  const yCols = (Array.isArray(spec.y) ? spec.y : [spec.y ?? "iv"]).map(String);

  let data = rows;
  if (spec.where) {
    const w = Object.entries(spec.where);
    data = data.filter((r) => w.every(([k, v]) => matchWhere(r[k], v)));
  }

  if (spec.reduce) {
    const { groupBy: gb, pick } = spec.reduce;
    const picked: Record<string, unknown>[] = [];
    for (const g of groupBy(data, gb).values()) {
      if (!pick) {
        if (g[0]) picked.push(g[0]);
        continue;
      }
      let best = g[0]!;
      let bd = Infinity;
      for (const r of g) {
        const d = Math.abs(num(r[pick.column]) - num(r[pick.target]));
        if (d < bd) {
          bd = d;
          best = r;
        }
      }
      picked.push(best);
    }
    return project(picked, x, yCols, (yc) => (yCols.length > 1 ? yc : "term"));
  }

  if (spec.series) {
    const out: CurveSeriesOut[] = [];
    for (const [k, g] of groupBy(data, spec.series)) {
      for (const series of project(g, x, yCols, (yc) => (yCols.length > 1 ? `${String(k)} ${yc}` : String(k)))) {
        out.push(series);
      }
    }
    return out;
  }

  return project(data, x, yCols, (yc) => String(yc));
}

// --- formatters (renderer display) ------------------------------------------

export const fmtPrice = (v: number): string => (Number.isFinite(v) && v !== 0 ? v.toFixed(2) : "—");
export const fmtPct = (v: number): string => (Number.isFinite(v) && v > 0 ? `${(v * 100).toFixed(1)}%` : "—");
export const fmtInt = (v: number): string => (Number.isFinite(v) ? Math.round(v).toLocaleString() : "—");
export const fmtNum = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : "—");
