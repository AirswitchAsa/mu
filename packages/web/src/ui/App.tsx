import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { traceFromOp, type CanvasOp, type CanvasState, type ChatMessage } from "@mu/protocol";
import { handlesToResolve, reconcile } from "../lib/manifest";
import { presetForSize } from "../lib/grid";
import type { OhlcvRow } from "../lib/types";
import { createSession, deleteSession, getCanvas, getMessages, postUserOps, resolveHandle, streamMessage } from "../lib/api";
import type { RenderTheme } from "../renderers/types";
import { Canvas } from "./Canvas";
import { Chat, type ChatTurn, type TraceLine } from "./Chat";
import { SessionRail } from "./SessionRail";
import { loadSessions, saveSessions, type SessionMeta } from "./sessionStore";
import { applyTheme, readTheme } from "./theme";
import { useTweaks } from "./useTweaks";

const REPO_URL = "https://github.com/AirswitchAsa/mu";

interface SessionView {
  manifest: CanvasState | null;
  chat: ChatTurn[];
  thinking: boolean;
  /** the ops-trace accumulating during the current turn (shown live, then attached). */
  pending: TraceLine[];
}
const emptyView = (): SessionView => ({ manifest: null, chat: [], thinking: false, pending: [] });

/** Server chat history → view turns. The ops-trace is now persisted server-side,
 *  so restored assistant turns carry it too (traceFromOp is the shared builder). */
const toTurn = (m: ChatMessage): ChatTurn => ({ role: m.role, text: m.text, ops: m.ops ? [...m.ops] : undefined });

function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }): JSX.Element {
  return (
    <button className="ds-btn ds-btn--icon ds-btn--sm" onClick={onToggle} title={dark ? "switch to light" : "switch to dark"} aria-label="toggle theme">
      {dark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

export function App(): JSX.Element {
  const [t, setTweak] = useTweaks();
  const [sessions, setSessions] = useState<SessionMeta[]>(loadSessions);
  const [activeId, setActiveId] = useState<string>("");
  const [railOpen, setRailOpen] = useState(false);
  const [views, setViews] = useState<Record<string, SessionView>>({});
  const [theme, setTheme] = useState<RenderTheme>(() => readTheme());
  const [dataVersion, setDataVersion] = useState(0);

  const cache = useRef<Map<string, OhlcvRow[]>>(new Map());
  const prevManifest = useRef<Record<string, CanvasState | null>>({});
  const booted = useRef(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // --- theme ---------------------------------------------------------------
  useLayoutEffect(() => {
    applyTheme(t.dark, t.accent, t.density);
    setTheme(readTheme());
  }, [t.dark, t.accent, t.density]);
  const themeKey = `${t.dark ? "d" : "l"}:${t.accent}`;

  useEffect(() => saveSessions(sessions), [sessions]);

  const setView = useCallback((id: string, fn: (v: SessionView) => SessionView): void => {
    setViews((prev) => ({ ...prev, [id]: fn(prev[id] ?? emptyView()) }));
  }, []);

  const resolveNeeded = useCallback((handles: string[]): void => {
    const need = handles.filter((h) => !cache.current.has(h));
    if (!need.length) return;
    void Promise.all(
      need.map((h) =>
        resolveHandle(h).then(
          (rows) => cache.current.set(h, rows),
          () => cache.current.set(h, []),
        ),
      ),
    ).then(() => setDataVersion((x) => x + 1));
  }, []);

  // Apply a server-authoritative manifest: diff vs the last one, resolve only the
  // handles that actually changed, store the new manifest for the next diff.
  const applyManifest = useCallback(
    (id: string, next: CanvasState): void => {
      const prev = prevManifest.current[id] ?? null;
      prevManifest.current[id] = next;
      setView(id, (v) => ({ ...v, manifest: next }));
      resolveNeeded(handlesToResolve(reconcile(prev, next)));
    },
    [setView, resolveNeeded],
  );

  // Load a session's canvas (recreating a stale id after a server restart).
  const ensureCanvas = useCallback(
    async (id: string): Promise<void> => {
      if (prevManifest.current[id]) return;
      try {
        const [canvas, messages] = await Promise.all([getCanvas(id), getMessages(id)]);
        applyManifest(id, canvas);
        if (messages.length) setView(id, (v) => ({ ...v, chat: messages.map(toTurn) }));
      } catch {
        // stale id — re-create a server session, keep the name, swap the id
        const nid = await createSession();
        setSessions((list) => list.map((s) => (s.id === id ? { ...s, id: nid, status: "empty" } : s)));
        setActiveId((cur) => (cur === id ? nid : cur));
        applyManifest(nid, { id: nid, windows: [], layout: {} });
      }
    },
    [applyManifest, setView],
  );

  // --- bootstrap -----------------------------------------------------------
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      let list = loadSessions();
      if (list.length === 0) {
        const id = await createSession();
        list = [{ id, name: "session 1", status: "empty" }];
        setSessions(list);
      }
      const first = list[0]!.id;
      setActiveId(first);
      await ensureCanvas(first);
    })();
  }, [ensureCanvas]);

  const active = views[activeId] ?? emptyView();
  const activeMeta = sessions.find((s) => s.id === activeId);
  const counts: Record<string, number> = {};
  for (const s of sessions) counts[s.id] = views[s.id]?.manifest?.windows.length ?? 0;

  // --- agent loop ----------------------------------------------------------
  const onSend = useCallback(
    async (text: string): Promise<void> => {
      const id = activeId;
      if (!id || (views[id] ?? emptyView()).thinking) return;
      setView(id, (v) => ({ ...v, chat: [...v.chat, { role: "user", text }], thinking: true, pending: [] }));
      const trace: TraceLine[] = [];
      const pushTrace = (line: TraceLine): void => {
        trace.push(line);
        setView(id, (v) => ({ ...v, pending: [...trace] })); // stream the ops-trace live
      };
      try {
        await streamMessage(id, text, (e) => {
          if (e.type === "tool") pushTrace({ verb: e.verb, arg: e.arg, ret: e.ret });
          else if (e.type === "canvas") {
            pushTrace(traceFromOp(e.op));
            applyManifest(id, e.state);
          } else if (e.type === "chat" && e.role === "assistant") {
            setView(id, (v) => ({ ...v, chat: [...v.chat, { role: "assistant", text: e.text, ops: [...trace] }] }));
          } else if (e.type === "error") {
            setView(id, (v) => ({ ...v, chat: [...v.chat, { role: "assistant", text: "", error: `${e.error.code ?? "ERROR"}: ${e.error.message}`, ops: [...trace] }] }));
          }
        });
      } catch (err) {
        setView(id, (v) => ({ ...v, chat: [...v.chat, { role: "assistant", text: "", error: err instanceof Error ? err.message : String(err) }] }));
      } finally {
        setView(id, (v) => ({ ...v, thinking: false, pending: [] }));
        setSessions((list) => list.map((s) => (s.id === id ? { ...s, status: "live" } : s)));
      }
    },
    [activeId, views, setView, applyManifest],
  );

  // --- sessions ------------------------------------------------------------
  const onPick = useCallback(
    (id: string): void => {
      setActiveId(id);
      void ensureCanvas(id);
      setRailOpen(false); // auto-hide the rail once a session is chosen
      composerRef.current?.focus(); // move the cursor off the rail, into the composer
    },
    [ensureCanvas],
  );

  const onNew = useCallback(async (): Promise<void> => {
    const id = await createSession();
    const n = sessions.length + 1;
    setSessions((list) => [...list, { id, name: `session ${n}`, status: "empty" }]);
    setActiveId(id);
    applyManifest(id, { id, windows: [], layout: {} });
    setRailOpen(false);
    composerRef.current?.focus();
  }, [sessions.length, applyManifest]);

  const onRename = useCallback((id: string, name: string): void => {
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, name } : s)));
  }, []);

  const onDelete = useCallback(
    async (id: string): Promise<void> => {
      void deleteSession(id).catch(() => undefined); // best-effort; client list is source of truth
      delete prevManifest.current[id];
      // the row cache is keyed by handle and shared across sessions — nothing to evict
      setViews((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      const remaining = sessions.filter((s) => s.id !== id);
      setSessions(remaining);
      if (activeId === id) {
        if (remaining.length) {
          setActiveId(remaining[0]!.id);
          void ensureCanvas(remaining[0]!.id);
        } else {
          const nid = await createSession();
          setSessions([{ id: nid, name: "session 1", status: "empty" }]);
          setActiveId(nid);
          applyManifest(nid, { id: nid, windows: [], layout: {} });
        }
      }
    },
    [sessions, activeId, ensureCanvas, applyManifest],
  );

  // --- user layout / content edits ----------------------------------------
  const patchManifest = useCallback(
    (id: string, fn: (m: CanvasState) => CanvasState): void => {
      const cur = prevManifest.current[id];
      if (!cur) return;
      const next = fn(cur);
      prevManifest.current[id] = next;
      setView(id, (v) => ({ ...v, manifest: next }));
    },
    [setView],
  );

  // Size control: a size index → the preset's grid spans, applied as a resize op.
  const onSize = useCallback(
    (winId: string, sizeIndex: number): void => {
      const patch = presetForSize(sizeIndex);
      patchManifest(activeId, (m) => ({ ...m, layout: { ...m.layout, [winId]: { ...(m.layout[winId] ?? { col: 0, row: 0, ...patch, pinned: false }), ...patch, pinned: true } } }));
      void postUserOps(activeId, [{ op: "resize", windowId: winId, placement: patch }]);
    },
    [activeId, patchManifest],
  );

  // Drag-to-reorder: reorder the windows array optimistically during the drag, then
  // persist the final order on drop with a single user `reorder` op.
  const onReorder = useCallback(
    (dragId: string, targetId: string, after: boolean): void => {
      if (dragId === targetId) return;
      patchManifest(activeId, (m) => {
        const moving = m.windows.find((w) => w.id === dragId);
        if (!moving) return m;
        const rest = m.windows.filter((w) => w.id !== dragId);
        const at = rest.findIndex((w) => w.id === targetId);
        if (at < 0) return m;
        rest.splice(after ? at + 1 : at, 0, moving);
        return { ...m, windows: rest };
      });
    },
    [activeId, patchManifest],
  );
  const onReorderCommit = useCallback(
    (dragId: string): void => {
      const m = prevManifest.current[activeId];
      if (!m) return;
      const idx = m.windows.findIndex((w) => w.id === dragId);
      if (idx < 0) return;
      // anchor to the new neighbor: prev sibling (after) or, if first, next sibling (before)
      const op =
        idx > 0
          ? { op: "reorder" as const, windowId: dragId, targetId: m.windows[idx - 1]!.id, after: true }
          : m.windows.length > 1
            ? { op: "reorder" as const, windowId: dragId, targetId: m.windows[idx + 1]!.id, after: false }
            : null;
      if (op) void postUserOps(activeId, [op]);
    },
    [activeId],
  );
  const onClose = useCallback(
    (winId: string): void => {
      patchManifest(activeId, (m) => {
        const layout = { ...m.layout };
        delete layout[winId];
        return { ...m, windows: m.windows.filter((w) => w.id !== winId), layout };
      });
      void postUserOps(activeId, [{ op: "delete", windowId: winId } as CanvasOp]);
    },
    [activeId, patchManifest],
  );

  return (
    <div className="mu-app">
      <div className="mu-left">
        <SessionRail
          sessions={sessions}
          activeId={activeId}
          counts={counts}
          expanded={railOpen}
          onHover={setRailOpen}
          onPick={onPick}
          onNew={onNew}
          onRename={onRename}
          onDelete={onDelete}
        />
        <header className="mu-head">
          <span className="mu-mark">µ</span>
          <a className="mu-head__gh" href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="github">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
          <div className="mu-head__right">
            <ThemeToggle dark={t.dark} onToggle={() => setTweak("dark", !t.dark)} />
          </div>
        </header>

        <div className="mu-body">
          <main className="mu-stage">
            <Canvas
              manifest={active.manifest}
              data={cache.current}
              dataVersion={dataVersion}
              theme={theme}
              themeKey={themeKey}
              onSize={onSize}
              onReorder={onReorder}
              onReorderCommit={onReorderCommit}
              onClose={onClose}
            />
          </main>
        </div>
      </div>

      <Chat
        name={activeMeta?.name ?? "session"}
        status={activeMeta?.status ?? "empty"}
        chat={active.chat}
        thinking={active.thinking}
        pendingOps={active.pending}
        width={t.chatWidth}
        inputRef={composerRef}
        onSend={onSend}
      />
    </div>
  );
}
