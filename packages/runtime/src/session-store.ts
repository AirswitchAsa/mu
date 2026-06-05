import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MuErrorException, type SessionState } from "@mu/protocol";

/**
 * SessionStore — all live sessions' SessionState (session-store.dog.md). The µ
 * session id is authoritative and stable; the opencode session it currently
 * drives is recorded separately as `opencodeSessionId` (re-mintable, see
 * reconcile-on-miss) — no longer 1:1. Holds bindings, never data; dropping a
 * session touches no broker data.
 *
 * Optionally durable: given a `dir`, each session is mirrored to `<dir>/<id>.json`
 * (atomic temp-then-rename, best-effort) and rehydrated via `load()` on boot, so a
 * server restart no longer silently loses every canvas. Writes are fire-and-forget
 * — a single-user playground favors a non-blocking write path; the on-disk copy is
 * derived state, rebuilt next write.
 */
export class SessionStore {
  private readonly sessions = new Map<string, SessionState>();

  constructor(private readonly dir?: string) {}

  /** Build a store, rehydrating any persisted sessions from `dir` (if given). */
  static async load(dir?: string): Promise<SessionStore> {
    const store = new SessionStore(dir);
    if (!dir) return store;
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir).catch(() => [] as string[]);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const state = JSON.parse(await readFile(join(dir, f), "utf8")) as SessionState;
        if (state && typeof state.id === "string" && Array.isArray(state.windows)) {
          store.sessions.set(state.id, state);
        }
      } catch {
        /* skip a corrupt sidecar — derived state, rebuilt on next write */
      }
    }
    return store;
  }

  private fileFor(id: string): string | undefined {
    return this.dir ? join(this.dir, `${encodeURIComponent(id)}.json`) : undefined;
  }

  private save(state: SessionState): void {
    const path = this.fileFor(state.id);
    if (!path) return;
    const tmp = `${path}.tmp`;
    void writeFile(tmp, JSON.stringify(state), "utf8")
      .then(() => rename(tmp, path))
      .catch(() => {
        /* best-effort: a failed mirror never breaks the live session */
      });
  }

  /** Persist the current state for `id` (call after in-place mutations, e.g. messages). */
  persist(id: string): void {
    const state = this.sessions.get(id);
    if (state) this.save(state);
  }

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
    this.save(state);
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
    this.save(state);
  }

  delete(id: string): boolean {
    const ok = this.sessions.delete(id);
    const path = this.fileFor(id);
    if (ok && path) {
      void rm(path, { force: true }).catch(() => {
        /* best-effort */
      });
    }
    return ok;
  }

  all(): SessionState[] {
    return [...this.sessions.values()];
  }
}
