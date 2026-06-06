import {
  chainLadder,
  expiriesOf,
  fmtInt,
  fmtNum,
  fmtPct,
  fmtPrice,
  latestSnapshot,
  type ChainRow,
  type Ladder,
  type LadderRow,
} from "../../lib/options";
import type { RenderContext, RendererInstance, RendererPlugin, RenderTheme } from "../types";

// =============================================================================
// `grid` — a cross-sectional data table. Its first consumer is `options_chain`,
// rendered as the canonical calls │ strike │ puts ladder: one row per strike for a
// chosen expiry, ATM row centered + highlighted, cells heat-shaded by a chosen metric
// (IV / volume / OI). Expiry tabs switch the visible slice (local UI state). The fold
// is pure (lib/options); this file is the imperative DOM. Binds the first handle.
// =============================================================================

const HEATS = ["iv", "volume", "open_interest"] as const;
type Heat = (typeof HEATS)[number];

const el = (tag: string, className?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

const heatOf = (spec: Record<string, unknown>): Heat => {
  const h = spec["heat"];
  return typeof h === "string" && (HEATS as readonly string[]).includes(h) ? (h as Heat) : "iv";
};
const specExpiry = (spec: Record<string, unknown>): string | undefined =>
  typeof spec["expiry"] === "string" ? (spec["expiry"] as string) : undefined;

const metricOf = (r: ChainRow | undefined, heat: Heat): number =>
  r ? (heat === "iv" ? r.smv || r.iv : heat === "volume" ? r.volume : r.open_interest) : NaN;

/** Per-side cells, ordered so the numbers read *toward* the central strike. */
function sideCells(r: ChainRow | undefined, side: "call" | "put", heat: Heat, accent: string, range: { lo: number; hi: number }): HTMLElement[] {
  const cell = (cls: string, txt: string, heatVal?: number): HTMLElement => {
    const td = el("td", `mu-dg__c ${cls}`, txt);
    if (heatVal !== undefined && Number.isFinite(heatVal) && range.hi > range.lo) {
      const a = Math.max(0, Math.min(1, (heatVal - range.lo) / (range.hi - range.lo)));
      td.style.background = `color-mix(in srgb, ${accent} ${(a * 55).toFixed(1)}%, transparent)`;
    }
    return td;
  };
  const iv = cell("mu-dg__c--iv", fmtPct(r?.smv || r?.iv || NaN), metricOf(r, heat));
  const cells = [
    cell("mu-dg__c--num mu-dg__c--soft", fmtInt(r?.volume ?? NaN)),
    cell("mu-dg__c--num mu-dg__c--soft", fmtInt(r?.open_interest ?? NaN)),
    iv,
    cell("mu-dg__c--num", fmtNum(r?.delta ?? NaN)),
    cell("mu-dg__c--num", fmtPrice(r?.bid ?? NaN)),
    cell("mu-dg__c--num", fmtPrice(r?.ask ?? NaN)),
  ];
  return side === "call" ? cells : cells.reverse();
}

const HEAD_CALL = ["Vol", "OI", "IV", "Δ", "Bid", "Ask"];
const HEAD_PUT = ["Bid", "Ask", "IV", "Δ", "OI", "Vol"];

const plugin: RendererPlugin = {
  type: "grid",
  mount(el0, ctx) {
    const host = el("div", "mu-datagrid");
    el0.appendChild(host);
    const tabs = el("div", "mu-datagrid__tabs");
    const scroll = el("div", "mu-datagrid__scroll");
    host.append(tabs, scroll);

    let selected: string | undefined; // local expiry selection (user tabs)
    let last: RenderContext = ctx;

    const render = (c: RenderContext): void => {
      last = c;
      const rows = latestSnapshot((c.data.get(c.handles[0] ?? "") ?? []) as unknown as ChainRow[]);
      const expiries = expiriesOf(rows);
      const accent = c.theme.action;
      const heat = heatOf(c.spec);

      if (rows.length === 0 || expiries.length === 0) {
        tabs.replaceChildren();
        scroll.replaceChildren(el("p", "mu-datagrid__empty", "no options data — bind an orats:options_chain handle"));
        return;
      }
      // resolve the active expiry: prior selection → spec → first
      if (!selected || !expiries.includes(selected)) selected = specExpiry(c.spec) ?? expiries[0]!;

      // --- expiry tabs ---
      tabs.replaceChildren();
      for (const exp of expiries) {
        const dte = rows.find((r) => r.expiry === exp)?.dte;
        const t = el("button", "mu-datagrid__tab", dte != null ? `${exp}  ·  ${dte}d` : exp) as HTMLButtonElement;
        if (exp === selected) t.dataset["active"] = "true";
        t.onclick = () => {
          selected = exp;
          drawTable(c, accent, heat);
        };
        tabs.appendChild(t);
      }
      drawTable(c, accent, heat);
    };

    function drawTable(c: RenderContext, accent: string, heat: Heat): void {
      const rows = latestSnapshot((c.data.get(c.handles[0] ?? "") ?? []) as unknown as ChainRow[]);
      const ladder: Ladder = chainLadder(rows, selected!);

      // heat range across the visible ladder for the chosen metric
      let lo = Infinity;
      let hi = -Infinity;
      for (const lr of ladder.rows) {
        for (const v of [metricOf(lr.call, heat), metricOf(lr.put, heat)]) {
          if (Number.isFinite(v) && v > 0) {
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
      }
      const range = { lo, hi };

      const table = el("table", "mu-datagrid__table");
      // grouped header
      const thead = el("thead");
      const grp = el("tr", "mu-datagrid__grouprow");
      grp.append(thEl(`Calls`, "mu-dg__h--side", 6), thEl("", "mu-dg__h--strike", 1), thEl(`Puts`, "mu-dg__h--side", 6));
      const cols = el("tr", "mu-datagrid__colrow");
      HEAD_CALL.forEach((h) => cols.appendChild(thEl(h, "mu-dg__h")));
      cols.appendChild(thEl("Strike", "mu-dg__h mu-dg__h--strike"));
      HEAD_PUT.forEach((h) => cols.appendChild(thEl(h, "mu-dg__h")));
      thead.append(grp, cols);

      const tbody = el("tbody");
      let atmEl: HTMLElement | null = null;
      for (const lr of ladder.rows) {
        const tr = rowEl(lr, ladder.atmStrike, heat, accent, range);
        if (lr.strike === ladder.atmStrike) atmEl = tr;
        tbody.appendChild(tr);
      }
      table.append(thead, tbody);
      scroll.replaceChildren(table);
      // center the ATM row
      if (atmEl) {
        requestAnimationFrame(() => {
          scroll.scrollTop = Math.max(0, (atmEl as HTMLElement).offsetTop - scroll.clientHeight / 2);
        });
      }
    }

    function rowEl(lr: LadderRow, atm: number, heat: Heat, accent: string, range: { lo: number; hi: number }): HTMLElement {
      const tr = el("tr", "mu-datagrid__row");
      if (lr.strike === atm) tr.dataset["atm"] = "true";
      for (const td of sideCells(lr.call, "call", heat, accent, range)) tr.appendChild(td);
      tr.appendChild(el("td", "mu-dg__c mu-dg__c--strike", fmtNum(lr.strike)));
      for (const td of sideCells(lr.put, "put", heat, accent, range)) tr.appendChild(td);
      return tr;
    }

    render(ctx);

    return {
      update: render,
      retheme(theme: RenderTheme) {
        render({ ...last, theme });
      },
      destroy() {
        host.remove();
      },
    } satisfies RendererInstance;
  },
};

function thEl(text: string, cls: string, colSpan = 1): HTMLElement {
  const th = el("th", cls, text);
  if (colSpan > 1) (th as HTMLTableCellElement).colSpan = colSpan;
  return th;
}

export default plugin;
