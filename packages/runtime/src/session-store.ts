import { MuErrorException, type SessionState } from "@mu/protocol";

/**
 * SessionStore — all live sessions' SessionState (session-store.dog.md). A µ
 * session id maps 1:1 to an opencode session id. Holds bindings, never data;
 * dropping a session touches no broker data.
 */
export class SessionStore {
  private readonly sessions = new Map<string, SessionState>();

  create(id: string, now = Date.now()): SessionState {
    const existing = this.sessions.get(id);
    if (existing) return existing;
    const state: SessionState = {
      id,
      windows: [],
      layout: {},
      messages: [],
      provenanceLog: [],
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(id, state);
    return state;
  }

  get(id: string): SessionState | undefined {
    return this.sessions.get(id);
  }

  require(id: string): SessionState {
    const state = this.sessions.get(id);
    if (!state) throw new MuErrorException("HANDLE_NOT_FOUND", `unknown session '${id}'`);
    return state;
  }

  replace(state: SessionState): void {
    this.sessions.set(state.id, state);
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }

  all(): SessionState[] {
    return [...this.sessions.values()];
  }
}
