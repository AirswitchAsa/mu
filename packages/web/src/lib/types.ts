import type { CanvasOp, CanvasState } from "@mu/protocol";

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
  | { type: "chat"; role: "assistant" | "user"; text: string }
  | { type: "done" }
  | { type: "error"; error: { code?: string; message: string } };
