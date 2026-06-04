// =============================================================================
// µ — relative-time formatting for the wire + release calendar (pure, testable).
// Mono labels: a past offset reads "14m" / "3h" / "2d"; a release reads "3h ago"
// or "in 2d". These are presentation helpers — the cards feed them mock offsets in
// v0; a live data plane would feed real timestamps the same way.
// =============================================================================

/** Minutes-ago → a compact mono label ("14m" / "3h" / "2d"). */
export function relAgo(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / (60 * 24))}d`;
}

/** Hours-from-now → "3h ago" (past) or "in 2d" (future); 0 reads as "now". */
export function relWhen(hrs: number): string {
  if (hrs === 0) return "now";
  const a = Math.abs(hrs);
  const mag = a < 24 ? `${a}h` : `${Math.round(a / 24)}d`;
  return hrs < 0 ? `${mag} ago` : `in ${mag}`;
}

// --- timestamp-based variants (for the live data plane) ----------------------
const MIN = 60_000;

/** Epoch-ms timestamp → compact age label vs `now` ("14m" / "3h" / "2d"). */
export function agoLabel(epochMs: number, now: number): string {
  return relAgo(Math.max(0, (now - epochMs) / MIN));
}

/** Epoch-ms timestamp → "3h ago" / "in 2d" / "now" vs `now`. */
export function whenLabel(epochMs: number, now: number): string {
  const hrs = Math.round((epochMs - now) / (60 * MIN));
  return relWhen(hrs);
}
