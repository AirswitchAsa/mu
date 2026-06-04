// =============================================================================
// µ — client session list (names + status), persisted to localStorage and mapped
// to real server session ids. The backend has no session catalog in v0, so the
// list lives here; a stale id (server restart) is re-created on demand.
// =============================================================================

export interface SessionMeta {
  id: string;
  name: string;
  /** an assistant reply arrived while this session wasn't active; cleared on open. */
  unread?: boolean;
  /** the user manually renamed it — stop syncing the name from opencode's title. */
  renamed?: boolean;
}

const KEY = "mu.sessions";

export function loadSessions(): SessionMeta[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SessionMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSessions(list: SessionMeta[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
