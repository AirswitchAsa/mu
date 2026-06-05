import type { MuDriver, TurnDelta } from "@mu/opencode-plugin";

// =============================================================================
// µ — a deterministic, scriptable stand-in for the agent (test only; excluded from
// the build). It implements the SAME MuDriver contract the server depends on and
// reaches µ through the SAME /internal HTTP callback the real opencode plugin uses
// (presenting the shared token, sending the OPENCODE session id as `sessionID`), so
// a turn-loop test exercises the real pathway — reconcile, tool dispatch + session
// translation, the live event bus, persistence — with no LLM. Set the per-turn
// behavior with `setScript`; inspect what happened via the recorded call logs.
// =============================================================================

export interface FakeTurn {
  /** the opencode session id the server asked us to drive (post-reconcile). */
  readonly sessionId: string;
  readonly text: string;
  /** appended prompt parts the server passed (canvas summary, restart priming). */
  readonly extraParts: readonly string[];
  /** stream a cumulative prose/reasoning part (→ the server's onDelta → chat_delta). */
  emit(partId: string, kind: TurnDelta["kind"], text: string): void;
  /** invoke a µ tool over /internal exactly as the plugin would; returns {ok}|{error}. */
  tool(verb: string, args: Record<string, unknown>): Promise<{ ok?: unknown; error?: { code: string } }>;
}

export type FakeScript = (turn: FakeTurn) => Promise<string>;

export class FakeDriver implements MuDriver {
  readonly created: string[] = [];
  readonly deleted: string[] = [];
  readonly aborted: string[] = [];
  readonly prompts: { sessionId: string; text: string; extraParts: string[] }[] = [];
  /** opencode ids this fake currently "knows" (drives sessionExists / reconcile). */
  readonly live = new Set<string>();
  title: string | undefined;
  private seq = 0;
  private script: FakeScript = async () => "ok";

  constructor(private readonly callbackUrl: string, private readonly callbackToken: string) {}

  /** Set the agent behavior for the NEXT turn(s). */
  setScript(fn: FakeScript): void {
    this.script = fn;
  }

  async createSession(): Promise<string> {
    const id = `oc-${++this.seq}`;
    this.created.push(id);
    this.live.add(id);
    return id;
  }
  async deleteSession(id: string): Promise<void> {
    this.deleted.push(id);
    this.live.delete(id);
  }
  async sessionExists(id: string): Promise<boolean> {
    return this.live.has(id);
  }
  async getSessionTitle(): Promise<string | undefined> {
    return this.title;
  }
  async abort(id: string): Promise<void> {
    this.aborted.push(id);
  }
  close(): void {}

  async prompt(
    sessionId: string,
    text: string,
    extraParts: string[] = [],
    onDelta?: (d: TurnDelta) => void,
  ): Promise<string> {
    this.prompts.push({ sessionId, text, extraParts: [...extraParts] });
    const turn: FakeTurn = {
      sessionId,
      text,
      extraParts,
      emit: (partId, kind, t) => onDelta?.({ partId, kind, text: t }),
      tool: (verb, args) => this.callTool(sessionId, verb, args),
    };
    return this.script(turn);
  }

  /** Hit /internal/tool/:verb the way the plugin does — opencode id as sessionID. */
  private async callTool(
    sessionID: string,
    verb: string,
    args: Record<string, unknown>,
  ): Promise<{ ok?: unknown; error?: { code: string } }> {
    const resp = await fetch(`${this.callbackUrl}/internal/tool/${verb}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mu-internal-token": this.callbackToken },
      body: JSON.stringify({ sessionID, args }),
    });
    return (await resp.json()) as { ok?: unknown; error?: { code: string } };
  }
}
