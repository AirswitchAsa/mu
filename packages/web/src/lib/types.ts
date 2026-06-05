import type { CanvasOp, CanvasState } from "@mu/protocol";

/** A resolved row from `GET /api/resolve` — shape-specific columns, untyped here. */
export type DataRow = Record<string, unknown>;
/** handle → resolved rows; one shared client cache across all card types. */
export type DataMap = Map<string, DataRow[]>;

/** A resolved OHLCV row from `GET /api/resolve` — `t` is epoch-MILLIS. */
export interface OhlcvRow {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose?: number;
  volume?: number;
}

/** A resolved `news` row (epoch-ms `published_at`; `tickers` comma-joined). */
export interface NewsRow {
  id: string;
  published_at: number;
  source: string;
  headline: string;
  summary?: string;
  url?: string;
  tickers?: string;
  image_url?: string;
  sentiment?: number;
}

/** A resolved `releases` row — one vintage (epoch-ms `as_of`/`release_time`). */
export interface ReleaseRow {
  event: string;
  name: string;
  reference_period: string;
  as_of: number;
  release_time: number;
  status: "scheduled" | "released" | "revised";
  forecast?: number;
  actual?: number;
  previous?: number;
  unit?: string;
  importance?: "high" | "med" | "low";
}

/** A resolved `key_stats` row — one stat field of a vintage (epoch-ms `as_of`). */
export interface KeyStatsRow {
  field: string;
  label: string;
  value: string;
  as_of: number;
  group?: string;
}

/**
 * Lightweight Charts datum shapes — `time` is epoch-SECONDS (we divide ms by 1000).
 * Kept as a plain `number` so the pure indicator tests stay value-based; renderers
 * cast to the chart lib's branded `Time` at the setData boundary.
 */
export interface CandleDatum {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}
export interface LineDatum {
  time: number;
  value: number;
}
export interface HistDatum {
  time: number;
  value: number;
  color?: string;
}

/**
 * SSE events from `POST /api/sessions/:id/message`. Mirrors the server's `MuEvent`
 * (kept local so the browser bundle never imports the node runtime). The `canvas`
 * event carries the FULL server-authoritative manifest the client reconciles.
 */
export type MuStreamEvent =
  | { type: "canvas"; op: CanvasOp; state: CanvasState }
  | { type: "tool"; verb: string; arg: string; ret: string }
  // Cumulative token-stream delta for one assistant part (prose or reasoning).
  // `text` is the FULL part text so far → upsert by `partId`, don't concatenate.
  | { type: "chat_delta"; partId: string; kind: "text" | "reasoning"; text: string }
  | { type: "chat"; role: "assistant" | "user"; text: string }
  | { type: "done" }
  | { type: "error"; error: { code?: string; message: string } };
