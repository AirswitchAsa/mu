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
const VERSION = 1;

interface StoredV1 {
  v: number;
  list: unknown[];
}

/** Coerce one persisted entry to a clean SessionMeta, dropping unknown keys; null if invalid. */
function normalize(entry: unknown): SessionMeta | null {
  if (!entry || typeof entry !== "object") return null;
  const o = entry as Record<string, unknown>;
  if (typeof o["id"] !== "string" || typeof o["name"] !== "string") return null;
  const m: SessionMeta = { id: o["id"], name: o["name"] };
  if (o["unread"] === true) m.unread = true;
  if (o["renamed"] === true) m.renamed = true;
  return m;
}

export function loadSessions(): SessionMeta[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    // v1 shape `{ v, list }`; legacy shape a bare array. Both normalized identically,
    // so a schema change (new/removed field) can't load a malformed object into state.
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as StoredV1)?.list)
        ? (parsed as StoredV1).list
        : [];
    return list.map(normalize).filter((m): m is SessionMeta => m !== null);
  } catch {
    return [];
  }
}

export function saveSessions(list: SessionMeta[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, list } satisfies StoredV1));
  } catch {
    /* ignore */
  }
}
