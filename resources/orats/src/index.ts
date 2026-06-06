import {
  MuErrorException,
  type FetchResult,
  type ResourceManifest,
} from "@mu/protocol";
import type { FetchContext, FetchParams, Resource } from "@mu/resource-sdk";

// =============================================================================
// µ — ORATS resource: `options_chain` snapshots from the Data API `/datav2/strikes`
// endpoint (one row per (expiry, strike) carrying BOTH sides). Keyed via
// ORATS_API_KEY; dormant until a key is present (isConfigured). Each fetch is one
// snapshot stamped with a single `as_of` (the provider snapshot time), so a refresh
// once the surface moves lands a NEW vintage — cross-section by construction.
// `fetchJson` is injectable so normalization is tested offline.
// =============================================================================

export type FetchJson = (url: string) => Promise<unknown>;

const realFetchJson: FetchJson = async (url) => {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new MuErrorException("FETCH_FAILED", `HTTP ${r.status} from ORATS`);
  try {
    return await r.json();
  } catch {
    throw new MuErrorException("FETCH_FAILED", "ORATS: non-JSON response (rate-limited or upstream error)");
  }
};

/** One ORATS `/datav2/strikes` row — a strike carrying both call and put fields. */
export interface OratsStrike {
  expirDate?: string;
  strike?: number;
  stockPrice?: number;
  spotPrice?: number;
  dte?: number;
  // call side
  callBidPrice?: number;
  callAskPrice?: number;
  callMidIv?: number;
  callSmvVol?: number;
  callOpenInterest?: number;
  callVolume?: number;
  // put side
  putBidPrice?: number;
  putAskPrice?: number;
  putMidIv?: number;
  putSmvVol?: number;
  putOpenInterest?: number;
  putVolume?: number;
  // shared (call-oriented) greeks + fitted vol
  smvVol?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  // snapshot timestamps
  snapShotDate?: string;
  updatedAt?: string;
  quoteDate?: string;
}

/** Coerce to a finite number; default `d` (keeps the shape's finite-number gate happy). */
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Pick the snapshot vintage (epoch-ms) from the provider snapshot time; fall back to `now`. */
export function snapshotAsOf(rows: readonly OratsStrike[], now: number): number {
  const r0 = rows[0];
  const stamp = r0?.snapShotDate ?? r0?.updatedAt ?? r0?.quoteDate;
  const ms = stamp ? Date.parse(stamp) : NaN;
  return Number.isFinite(ms) ? Math.trunc(ms) : now;
}

/**
 * Normalize ORATS strike rows into canonical `options_chain` records — splitting each
 * strike into a `call` row and a `put` row. The provider gives one delta per strike
 * (the call delta); the put delta is `delta − 1`. Gamma/theta/vega are shared. Rows
 * missing an expiry or strike are dropped.
 */
export function chainRecords(rows: readonly OratsStrike[], asOf: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    if (typeof r.expirDate !== "string" || typeof r.strike !== "number") continue;
    const expiry = r.expirDate;
    const strike = r.strike;
    const underlying = num(r.stockPrice ?? r.spotPrice);
    const dte = Math.trunc(num(r.dte));
    const gamma = num(r.gamma);
    const theta = num(r.theta);
    const vega = num(r.vega);
    const callDelta = num(r.delta);

    const callBid = num(r.callBidPrice);
    const callAsk = num(r.callAskPrice);
    out.push({
      id: `${expiry}|${strike}|call`,
      expiry,
      strike,
      right: "call",
      bid: callBid,
      ask: callAsk,
      mid: (callBid + callAsk) / 2,
      iv: num(r.callMidIv),
      smv: num(r.callSmvVol ?? r.smvVol),
      delta: callDelta,
      gamma,
      theta,
      vega,
      open_interest: num(r.callOpenInterest),
      volume: num(r.callVolume),
      underlying,
      dte,
      as_of: asOf,
    });

    const putBid = num(r.putBidPrice);
    const putAsk = num(r.putAskPrice);
    out.push({
      id: `${expiry}|${strike}|put`,
      expiry,
      strike,
      right: "put",
      bid: putBid,
      ask: putAsk,
      mid: (putBid + putAsk) / 2,
      iv: num(r.putMidIv),
      smv: num(r.putSmvVol ?? r.smvVol),
      delta: callDelta - 1, // put-call delta parity (call_delta − 1)
      gamma,
      theta,
      vega,
      open_interest: num(r.putOpenInterest),
      volume: num(r.putVolume),
      underlying,
      dte,
      as_of: asOf,
    });
  }
  return out;
}

export function createOratsResource(deps: { fetchJson?: FetchJson; apiKey?: string } = {}): Resource {
  const fetchJson = deps.fetchJson ?? realFetchJson;
  const key = (): string | undefined => deps.apiKey ?? process.env["ORATS_API_KEY"];

  const manifest: ResourceManifest = {
    id: "orats",
    shapes: ["options_chain"],
    params: [
      { name: "shape", required: true, description: "options_chain" },
      { name: "entity", required: true, description: "ticker symbol, e.g. AMZN" },
    ],
    configSchema: ["ORATS_API_KEY"],
    cadence: { everyMs: 5 * 60_000 },
  };

  return {
    manifest,
    isConfigured: () => Boolean(key()),
    async fetch(params: FetchParams, ctx: FetchContext): Promise<FetchResult> {
      const token = key();
      if (!token) throw new MuErrorException("NOT_CONFIGURED", "ORATS: ORATS_API_KEY is not set");
      if (params.shape !== "options_chain") {
        throw new MuErrorException("UNKNOWN_SOURCE", `ORATS does not produce shape '${params.shape}'`);
      }
      const entity = params.entity;
      const now = ctx.now();
      const url = `https://api.orats.io/datav2/strikes?token=${token}&ticker=${encodeURIComponent(entity)}`;
      const raw = (await fetchJson(url)) as { data?: OratsStrike[] };
      const rows = Array.isArray(raw?.data) ? raw.data : [];
      const asOf = snapshotAsOf(rows, now);
      const payload = chainRecords(rows, asOf);

      return {
        descriptor: {
          shape: "options_chain",
          identity: { provider: "orats", shape: "options_chain", entity, tail: [] },
          queryParams: { entity },
        },
        provenance: {
          source: "orats",
          fetchedAt: now,
          trigger: ctx.trigger,
          queryParams: { entity },
          upstream: { endpoint: "datav2/strikes", asOf, strikes: rows.length },
        },
        payload,
      };
    },
  };
}

export const resource = createOratsResource();
