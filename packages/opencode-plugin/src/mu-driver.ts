// =============================================================================
// µ — the agent-driver contract. The server depends on THIS, not on OpencodeDriver
// concretely, so the whole `/message` turn pathway (reconcile → prompt → stream →
// persist) can be exercised end-to-end with a deterministic fake agent — no live
// LLM. OpencodeDriver is the production implementation; a test FakeDriver is the
// other. The methods are exactly what the server calls; keep this set minimal.
// =============================================================================

/** One streamed assistant message part (prose or reasoning); `text` is CUMULATIVE
 *  per `partId` (each delta carries the full part text so far). */
export interface TurnDelta {
  readonly partId: string;
  readonly kind: "text" | "reasoning";
  readonly text: string;
}

export interface MuDriver {
  /** Mint a fresh agent session, returning its id. */
  createSession(): Promise<string>;
  /** Tear down an agent session (best-effort). */
  deleteSession(id: string): Promise<void>;
  /** True if the agent backend still knows this session id (drives reconcile-on-miss). */
  sessionExists(id: string): Promise<boolean>;
  /** The agent's auto-generated session title, or undefined. */
  getSessionTitle(id: string): Promise<string | undefined>;
  /**
   * Drive one turn. `extraParts` are appended prompt parts (canvas summary, restart
   * priming). `onDelta`, when given, fires for each streamed prose/reasoning part.
   * Resolves to the authoritative final assistant text.
   */
  prompt(
    sessionId: string,
    text: string,
    extraParts?: string[],
    onDelta?: (d: TurnDelta) => void,
  ): Promise<string>;
  /** Cancel an in-flight turn (best-effort) so it stops spending against a dead socket. */
  abort(id: string): Promise<void>;
  /** Release the backend. */
  close(): void;
}
