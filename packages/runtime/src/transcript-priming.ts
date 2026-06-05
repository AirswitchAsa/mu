import type { ChatMessage } from "@mu/protocol";

/** Max prior turns (user+assistant entries) folded into a priming block. */
const MAX_TURNS = 10;
/** Hard char cap on the assembled block, so a long history can't blow the prompt. */
const MAX_CHARS = 4_000;

/**
 * Build a compact priming block from a µ session's stored transcript, to seed a
 * FRESHLY MINTED opencode session with conversational context after a
 * reconcile-on-miss re-mint (transcript replay — "robust retrieval from
 * opencode territory": µ is the authoritative record, opencode is disposable).
 *
 * Bounded twice over (last `MAX_TURNS` entries AND a `MAX_CHARS` cap, dropping
 * oldest first) and ordered oldest→newest with `User:` / `µ:` prefixes so the
 * agent reads it as a transcript. Returns `undefined` when there's nothing worth
 * replaying (no prior dialogue) — the caller then primes nothing.
 *
 * NOTE: canvas state is NOT replayed here. The cheap canvas summary is already
 * re-injected on EVERY turn (inject_canvas_state), so the agent always sees the
 * current canvas — only the dialogue needs replay.
 */
export function buildPrimingText(messages: readonly ChatMessage[]): string | undefined {
  // Keep only entries that carry text; the most recent MAX_TURNS of them.
  const recent = messages.filter((m) => m.text.trim().length > 0).slice(-MAX_TURNS);
  if (recent.length === 0) return undefined;

  // Format oldest→newest, then drop from the FRONT until under the char cap, so
  // the freshest exchanges always survive the budget.
  const lines = recent.map((m) => `${m.role === "user" ? "User" : "µ"}: ${m.text.trim()}`);
  while (lines.length > 1 && lines.join("\n").length > MAX_CHARS) lines.shift();

  const body = lines.join("\n");
  return (
    "[µ session resumed] You are continuing an existing µ session whose executor was " +
    "restarted, so you have no memory of it. Here is the prior conversation for context " +
    "(do not respond to it; just use it to stay consistent):\n\n" +
    body
  );
}
