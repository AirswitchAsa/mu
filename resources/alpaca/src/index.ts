import {
  MuErrorException,
  type FetchResult,
  type ResourceManifest,
} from "@mu/protocol";
import type { FetchContext, FetchParams, Resource } from "@mu/resource-sdk";

// =============================================================================
// µ — Alpaca resource: the brokerage **read plane**. One resource, three shapes off
// the standard Trading API:
//   • positions  — open holdings        (/v2/positions)               → the `positions` table
//   • key_stats  — account balances     (/v2/account)                 → the `key_stats` panel
//   • ohlcv      — equity curve         (/v2/account/portfolio/history)→ a `compare` line
// Balances are scalars (they ride key_stats) and the equity curve is a time path
// (it rides ohlcv, close = equity) — only the holdings table is a new primitive.
// Keyed via ALPACA_API_KEY_ID + ALPACA_API_SECRET; dormant until both are present
// (isConfigured). The handle entity is the ACCOUNT (`PORTFOLIO`), not a ticker — a
// brokerage handle is per-account. `fetchJson` is injectable so normalization is
// tested offline; the default impl prepends the base URL and adds the auth headers.
// This is display only; *controlling* the account (orders) is a separate MCP plane.
// =============================================================================

/** Fetch an Alpaca API path (e.g. "/v2/positions") and parse JSON. Injectable for tests. */
export type FetchJson = (path: string) => Promise<unknown>;

/** Coerce a value (Alpaca returns numbers as strings) to a finite number; default 0. */
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

// --- display formatters (balances render as display-ready key_stats strings) -------

const usd = (v: number): string => {
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `-$${s}` : `$${s}`;
};
const signedUsd = (v: number): string => (v >= 0 ? `+${usd(v)}` : usd(v));
const signedPct = (frac: number): string => `${frac >= 0 ? "+" : ""}${(frac * 100).toFixed(2)}%`;

// --- normalizers (pure, exported for offline tests) --------------------------------

/** One Alpaca `/v2/positions` row (numbers arrive as strings). */
export interface AlpacaPosition {
  symbol?: string;
  qty?: string | number;
  side?: string;
  avg_entry_price?: string | number;
  current_price?: string | number;
  market_value?: string | number;
  cost_basis?: string | number;
  unrealized_pl?: string | number;
  unrealized_plpc?: string | number;
  change_today?: string | number;
  asset_class?: string;
}

/** Normalize Alpaca positions into canonical `positions` records (rows missing a symbol drop). */
export function positionRecords(rows: readonly AlpacaPosition[], asOf: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const p of rows) {
    if (typeof p.symbol !== "string" || p.symbol.length === 0) continue;
    out.push({
      symbol: p.symbol,
      qty: num(p.qty),
      side: p.side === "short" ? "short" : "long",
      avg_entry: num(p.avg_entry_price),
      price: num(p.current_price),
      market_value: num(p.market_value),
      cost_basis: num(p.cost_basis),
      unrealized_pl: num(p.unrealized_pl),
      unrealized_plpc: num(p.unrealized_plpc),
      change_today: num(p.change_today),
      asset_class: typeof p.asset_class === "string" && p.asset_class.length > 0 ? p.asset_class : "us_equity",
      as_of: asOf,
    });
  }
  return out;
}

/** One Alpaca `/v2/account` payload (the fields we surface as balances). */
export interface AlpacaAccount {
  equity?: string | number;
  last_equity?: string | number;
  cash?: string | number;
  buying_power?: string | number;
  long_market_value?: string | number;
}

/**
 * Normalize the Alpaca account into `key_stats` records (display-ready strings): the
 * balances panel (equity / cash / buying power / long market value) and a performance
 * group (day P/L $ and %, derived from equity vs the prior session's last_equity).
 */
export function balanceRecords(acct: AlpacaAccount, asOf: number): Record<string, unknown>[] {
  const equity = num(acct.equity);
  const lastEquity = num(acct.last_equity);
  const dayPl = equity - lastEquity;
  const dayPlPct = lastEquity !== 0 ? dayPl / lastEquity : 0;
  return [
    { field: "equity", label: "Equity", value: usd(equity), as_of: asOf, group: "balances" },
    { field: "cash", label: "Cash", value: usd(num(acct.cash)), as_of: asOf, group: "balances" },
    { field: "buying_power", label: "Buying Power", value: usd(num(acct.buying_power)), as_of: asOf, group: "balances" },
    { field: "long_market_value", label: "Long Market Value", value: usd(num(acct.long_market_value)), as_of: asOf, group: "balances" },
    { field: "day_pl", label: "Day P/L", value: signedUsd(dayPl), as_of: asOf, group: "performance" },
    { field: "day_pl_pct", label: "Day P/L %", value: signedPct(dayPlPct), as_of: asOf, group: "performance" },
  ];
}

/** Alpaca `/v2/account/portfolio/history` payload (parallel arrays; timestamps in SECONDS). */
export interface AlpacaHistory {
  timestamp?: number[];
  equity?: (number | null)[];
}

/**
 * Normalize the equity history into degenerate `ohlcv` rows (open=high=low=close=equity,
 * volume 0) so the time-series `compare` card can draw the portfolio's return line.
 * Points before the account was funded (equity ≤ 0) are dropped so index-normalization
 * has a positive base.
 */
export function equityRecords(hist: AlpacaHistory): Record<string, unknown>[] {
  const ts = Array.isArray(hist.timestamp) ? hist.timestamp : [];
  const eq = Array.isArray(hist.equity) ? hist.equity : [];
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < ts.length; i++) {
    const e = num(eq[i]);
    if (e <= 0) continue;
    out.push({ t: Math.trunc(ts[i]! * 1000), open: e, high: e, low: e, close: e, adjClose: e, volume: 0 });
  }
  return out;
}

export function createAlpacaResource(
  deps: { fetchJson?: FetchJson; keyId?: string; secret?: string; baseUrl?: string } = {},
): Resource {
  const creds = (): { keyId?: string; secret?: string; baseUrl: string } => ({
    keyId: deps.keyId ?? process.env["ALPACA_API_KEY_ID"],
    secret: deps.secret ?? process.env["ALPACA_API_SECRET"],
    baseUrl: deps.baseUrl ?? process.env["ALPACA_BASE_URL"] ?? "https://paper-api.alpaca.markets",
  });

  const defaultFetchJson: FetchJson = async (path) => {
    const c = creds();
    const root = c.baseUrl.replace(/\/$/, "").replace(/\/v2$/, "");
    const r = await fetch(root + path, {
      headers: { "APCA-API-KEY-ID": c.keyId ?? "", "APCA-API-SECRET-KEY": c.secret ?? "", accept: "application/json" },
    });
    if (!r.ok) throw new MuErrorException("FETCH_FAILED", `HTTP ${r.status} from Alpaca`);
    try {
      return await r.json();
    } catch {
      throw new MuErrorException("FETCH_FAILED", "Alpaca: non-JSON response (rate-limited or upstream error)");
    }
  };

  const fetchJson = deps.fetchJson ?? defaultFetchJson;

  const manifest: ResourceManifest = {
    id: "alpaca",
    shapes: ["positions", "key_stats", "ohlcv"],
    // `positions` is alpaca-only (safe to default to). But `key_stats` (account balances)
    // and `ohlcv` (the equity curve) reuse general-purpose shapes that Finnhub/Yahoo also
    // produce for arbitrary tickers — so alpaca must NOT be the auto-default for them, or a
    // plain `data_fetch {shape:'ohlcv', entity:'AAPL'}` would route here and ignore AAPL.
    // The agent always names {source:'alpaca'} for the portfolio (the manifests say so).
    explicitOnlyShapes: ["key_stats", "ohlcv"],
    params: [
      { name: "shape", required: true, description: "positions | key_stats | ohlcv" },
      { name: "entity", required: true, description: "the account label — use 'portfolio'" },
      { name: "resolution", required: false, description: "ohlcv only — equity-curve bar size (default 1D)" },
    ],
    configSchema: ["ALPACA_API_KEY_ID", "ALPACA_API_SECRET"],
    cadence: { everyMs: 60_000 },
  };

  return {
    manifest,
    isConfigured: () => {
      const c = creds();
      return Boolean(c.keyId && c.secret);
    },
    async fetch(params: FetchParams, ctx: FetchContext): Promise<FetchResult> {
      const c = creds();
      if (!c.keyId || !c.secret) {
        throw new MuErrorException("NOT_CONFIGURED", "Alpaca: ALPACA_API_KEY_ID / ALPACA_API_SECRET are not set");
      }
      // Alpaca always returns THE configured account — never an arbitrary ticker — so the
      // handle identity is NORMALIZED to a stable account label regardless of what the agent
      // passed for `entity`, and the equity curve is always the daily series. This keeps the
      // handle truthful and deduped even if the agent passes a stray ticker or resolution
      // (a bind to the returned handle then just works). The agent's input rides in queryParams.
      const ACCOUNT = "portfolio";
      const now = ctx.now();

      if (params.shape === "positions") {
        const raw = await fetchJson("/v2/positions");
        const rows = Array.isArray(raw) ? (raw as AlpacaPosition[]) : [];
        return {
          descriptor: { shape: "positions", identity: { provider: "alpaca", shape: "positions", entity: ACCOUNT, tail: [] }, queryParams: { entity: params.entity } },
          provenance: { source: "alpaca", fetchedAt: now, trigger: ctx.trigger, queryParams: { entity: params.entity }, upstream: { endpoint: "v2/positions", count: rows.length } },
          payload: positionRecords(rows, now),
        };
      }

      if (params.shape === "key_stats") {
        const raw = (await fetchJson("/v2/account")) as AlpacaAccount;
        return {
          descriptor: { shape: "key_stats", identity: { provider: "alpaca", shape: "key_stats", entity: ACCOUNT, tail: [] }, queryParams: { entity: params.entity } },
          provenance: { source: "alpaca", fetchedAt: now, trigger: ctx.trigger, queryParams: { entity: params.entity }, upstream: { endpoint: "v2/account" } },
          payload: balanceRecords(raw ?? {}, now),
        };
      }

      if (params.shape === "ohlcv") {
        const raw = (await fetchJson("/v2/account/portfolio/history?period=3M&timeframe=1D")) as AlpacaHistory;
        return {
          descriptor: { shape: "ohlcv", identity: { provider: "alpaca", shape: "ohlcv", entity: ACCOUNT, tail: ["1D"] }, queryParams: { entity: params.entity, resolution: "1D" } },
          provenance: { source: "alpaca", fetchedAt: now, trigger: ctx.trigger, queryParams: { entity: params.entity, resolution: "1D" }, upstream: { endpoint: "v2/account/portfolio/history" } },
          payload: equityRecords(raw ?? {}),
        };
      }

      throw new MuErrorException("UNKNOWN_SOURCE", `Alpaca does not produce shape '${params.shape}'`);
    },
  };
}

export const resource = createAlpacaResource();
