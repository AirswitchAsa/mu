import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { applyTimelineEvent, emptyTimeline, type CanvasOp, type CanvasState, type ChatMessage, type TurnItem } from "@mu/protocol";
import { handlesToResolve, reconcile } from "../lib/manifest";
import { presetForSize } from "../lib/grid";
import type { DataMap } from "../lib/types";
import { cancelTurn, createSession, deleteSession, getCanvas, getMessages, openEvents, postUserOps, refreshSession, resolveHandle, sendMessage, sessionTitle } from "../lib/api";
import type { MuStreamEvent } from "../lib/types";
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
  /** the interleaved timeline (prose/reasoning/tool) accumulating during the current
   *  turn — shown live, then committed onto the assistant turn (live≡reload). */
  pending: TurnItem[];
}
const emptyView = (): SessionView => ({ manifest: null, chat: [], thinking: false, pending: [] });

/** Server chat history → view turns. Both the interleaved timeline (`items`) and the
 *  ops-trace are persisted server-side, so a restored assistant turn renders exactly
 *  as it streamed (live≡reload); `text`/`ops` remain the fallback for legacy turns. */
const toTurn = (m: ChatMessage): ChatTurn => ({
  role: m.role,
  text: m.text,
  ops: m.ops ? [...m.ops] : undefined,
  items: m.items ? [...m.items] : undefined,
});

function RefreshButton({ spinning, disabled, onClick }: { spinning: boolean; disabled: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      className="ds-btn ds-btn--icon ds-btn--sm"
      onClick={onClick}
      disabled={disabled || spinning}
      title={disabled ? "nothing to refresh" : "refresh data"}
      aria-label="refresh data"
    >
      <svg className={spinning ? "mu-spin" : undefined} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  );
}

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
  const [refreshing, setRefreshing] = useState(false);

  const cache = useRef<DataMap>(new Map());
  const prevManifest = useRef<Record<string, CanvasState | null>>({});
  const booted = useRef(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // One open read stream (EventSource closer) per OPENED session, and the in-flight
  // timeline accumulator each turn folds into. The stream is the only live channel —
  // commands just POST; events drive every state change — so a refresh or a second tab
  // re-attaches by reconnecting, never by re-running the turn.
  const streams = useRef<Record<string, () => void>>({});
  const tls = useRef<Record<string, ReturnType<typeof emptyTimeline>>>({});
  // current active session, readable inside the (long-lived) stream handler (for unread).
  const activeIdRef = useRef(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // Pull opencode's auto-generated title and adopt it as the session name, unless
  // the user has manually renamed (their choice always wins).
  const syncTitle = useCallback(async (id: string): Promise<void> => {
    const title = await sessionTitle(id);
    if (!title) return;
    setSessions((list) => list.map((s) => (s.id === id && !s.renamed ? { ...s, name: title } : s)));
  }, []);

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

  // Drop cached rows for handles no longer bound by ANY window in ANY session — the
  // cache is shared and would otherwise grow unbounded as charts/sessions close.
  const evictCache = useCallback((): void => {
    const live = new Set<string>();
    for (const m of Object.values(prevManifest.current)) {
      if (!m) continue;
      for (const w of m.windows) for (const h of w.bindings) live.add(h);
    }
    for (const h of [...cache.current.keys()]) if (!live.has(h)) cache.current.delete(h);
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
      evictCache(); // a manifest may have dropped windows → free their rows
    },
    [setView, resolveNeeded, evictCache],
  );

  // --- live read stream (CQRS) ---------------------------------------------
  // Fold one event for session `id` into its view. Held in a ref and reassigned every
  // render so the long-lived EventSource always calls the freshest closures without
  // re-subscribing. The stream is the SOLE source of truth for the live turn: the user
  // bubble, the streaming items, the commit, the canvas — all flow from here, so this
  // device, a second device, and a post-refresh reconnect all converge on the same state.
  const onEventRef = useRef<(id: string, e: MuStreamEvent) => void>(() => undefined);
  onEventRef.current = (id, e): void => {
    const tl = tls.current[id] ?? (tls.current[id] = emptyTimeline());
    const opsOf = (): TraceLine[] => tl.items.filter((it): it is Extract<TurnItem, { kind: "tool" }> => it.kind === "tool");
    const markUnread = (): void => {
      if (id !== activeIdRef.current) setSessions((list) => list.map((s) => (s.id === id ? { ...s, unread: true } : s)));
    };
    switch (e.type) {
      case "chat":
        if (e.role === "user") {
          // A turn began (here or on another device): show the prompt, reset the in-flight
          // timeline, enter "thinking". The single source for the user bubble (no optimistic
          // echo), so every reader renders it identically.
          tls.current[id] = emptyTimeline();
          setView(id, (v) => ({ ...v, chat: [...v.chat, { role: "user", text: e.text }], pending: [], thinking: true }));
        } else {
          // Authoritative final assistant text → commit the turn from the streamed items.
          setView(id, (v) => ({ ...v, chat: [...v.chat, { role: "assistant", text: e.text, items: [...tl.items], ops: opsOf() }], pending: [], thinking: false }));
        }
        return;
      case "canvas":
        applyTimelineEvent(tl, e);
        applyManifest(id, e.state);
        setView(id, (v) => ({ ...v, pending: [...tl.items], thinking: true }));
        return;
      case "tool":
      case "chat_delta":
        applyTimelineEvent(tl, e);
        setView(id, (v) => ({ ...v, pending: [...tl.items], thinking: true }));
        return;
      case "error": {
        const stopped = e.error.code === "STOPPED";
        setView(id, (v) => ({
          ...v,
          chat: [...v.chat, { role: "assistant", text: "", error: stopped ? "stopped" : `${e.error.code ?? "ERROR"}: ${e.error.message}`, items: tl.items.length ? [...tl.items] : undefined, ops: opsOf() }],
          pending: [],
          thinking: false,
        }));
        tls.current[id] = emptyTimeline();
        void syncTitle(id);
        markUnread();
        return;
      }
      case "done":
        setView(id, (v) => ({ ...v, thinking: false, pending: [] }));
        tls.current[id] = emptyTimeline();
        void syncTitle(id); // opencode has (re)generated the title by turn-end
        markUnread();
        return;
    }
  };

  // Open (once) a session's read stream. Idempotent — a session keeps a single stream for
  // the app's life, so switching away never drops a background turn and switching back never
  // double-subscribes. A fresh connect replays an in-flight turn; an idle one only tails new.
  const connect = useCallback((id: string): void => {
    if (streams.current[id]) return;
    streams.current[id] = openEvents(id, (e) => onEventRef.current(id, e));
  }, []);

  // Tear down every stream on unmount.
  useEffect(() => {
    const open = streams.current;
    return () => {
      for (const close of Object.values(open)) close();
    };
  }, []);

  // Load a session's canvas + history, then open its live stream (which replays any
  // in-flight turn — this is what makes a refresh mid-generation rejoin it).
  const ensureCanvas = useCallback(
    async (id: string): Promise<void> => {
      if (prevManifest.current[id]) {
        connect(id); // already loaded → make sure the stream is open (e.g. after a swap)
        return;
      }
      try {
        const [canvas, messages] = await Promise.all([getCanvas(id), getMessages(id)]);
        applyManifest(id, canvas);
        if (messages.length) {
          setView(id, (v) => ({ ...v, chat: messages.map(toTurn) }));
          void syncTitle(id); // a session with history has an opencode title to adopt
        }
        connect(id);
      } catch {
        // stale id — re-create a server session, keep the name, swap the id
        const nid = await createSession();
        setSessions((list) => list.map((s) => (s.id === id ? { ...s, id: nid } : s)));
        setActiveId((cur) => (cur === id ? nid : cur));
        applyManifest(nid, { id: nid, windows: [], layout: {} });
        connect(nid);
      }
    },
    [applyManifest, setView, syncTitle, connect],
  );

  // --- bootstrap -----------------------------------------------------------
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      let list = loadSessions();
      if (list.length === 0) {
        const id = await createSession();
        list = [{ id, name: "session 1" }];
        setSessions(list);
      }
      const first = list[0]!.id;
      setActiveId(first);
      await ensureCanvas(first);
    })();
  }, [ensureCanvas]);

  const active = views[activeId] ?? emptyView();
  const activeMeta = sessions.find((s) => s.id === activeId);
  const liveHandleCount = active.manifest
    ? new Set(active.manifest.windows.flatMap((w) => w.bindings)).size
    : 0;
  const counts: Record<string, number> = {};
  for (const s of sessions) counts[s.id] = views[s.id]?.manifest?.windows.length ?? 0;

  // --- agent loop ----------------------------------------------------------
  // Send is a pure COMMAND: POST and return. The turn's events — including the echo of
  // this prompt — arrive on the read stream (onEventRef) like any other, so a refresh or
  // a second device sees an identical turn. We set `thinking` optimistically for instant
  // feedback (the stream confirms it ~1 RTT later); a failed command rolls it back.
  const onSend = useCallback(
    async (text: string): Promise<void> => {
      const id = activeId;
      if (!id || (views[id] ?? emptyView()).thinking) return;
      connect(id); // ensure the stream is open before the echo/events land
      setView(id, (v) => ({ ...v, thinking: true }));
      try {
        await sendMessage(id, text);
      } catch (err) {
        // NO_DRIVER / BUSY / transport — surface it and drop back out of "thinking".
        setView(id, (v) => ({
          ...v,
          thinking: false,
          chat: [...v.chat, { role: "assistant", text: "", error: err instanceof Error ? err.message : String(err) }],
        }));
      }
    },
    [activeId, views, setView, connect],
  );

  // Stop the in-flight turn: an explicit command (NOT a socket close). The server aborts
  // the agent and emits a STOPPED event, which the stream commits as the partial turn.
  const onStop = useCallback((): void => {
    void cancelTurn(activeId);
  }, [activeId]);

  // --- manual refresh (global) --------------------------------------------
  // Re-acquire every data-backed handle in the active session from its source,
  // then re-resolve exactly those (bust their cache entries). Backend owns the
  // fetch+merge; this is request/response, no streaming.
  const onRefresh = useCallback(async (): Promise<void> => {
    const id = activeId;
    if (!id || refreshing) return;
    setRefreshing(true);
    try {
      const { refreshed } = await refreshSession(id);
      for (const h of refreshed) cache.current.delete(h);
      if (refreshed.length) resolveNeeded(refreshed);
    } catch {
      /* best-effort; a failed refresh leaves last-good data on screen */
    } finally {
      setRefreshing(false);
    }
  }, [activeId, refreshing, resolveNeeded]);

  // --- sessions ------------------------------------------------------------
  const onPick = useCallback(
    (id: string): void => {
      setActiveId(id);
      setSessions((list) => list.map((s) => (s.id === id && s.unread ? { ...s, unread: false } : s)));
      void ensureCanvas(id);
      setRailOpen(false); // auto-hide the rail once a session is chosen
      composerRef.current?.focus(); // move the cursor off the rail, into the composer
    },
    [ensureCanvas],
  );

  const onNew = useCallback(async (): Promise<void> => {
    const id = await createSession();
    const n = sessions.length + 1;
    setSessions((list) => [...list, { id, name: `session ${n}` }]);
    setActiveId(id);
    applyManifest(id, { id, windows: [], layout: {} });
    connect(id); // open its read stream (a fresh session, so just tails new events)
    setRailOpen(false);
    composerRef.current?.focus();
  }, [sessions.length, applyManifest, connect]);

  const onRename = useCallback((id: string, name: string): void => {
    // a manual rename pins the name — stop syncing it from opencode's title.
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, name, renamed: true } : s)));
  }, []);

  const onDelete = useCallback(
    async (id: string): Promise<void> => {
      void deleteSession(id).catch(() => undefined); // best-effort; client list is source of truth
      streams.current[id]?.(); // close its read stream
      delete streams.current[id];
      delete tls.current[id];
      delete prevManifest.current[id];
      evictCache(); // free rows that were only bound by this session's windows
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
          setSessions([{ id: nid, name: "session 1" }]);
          setActiveId(nid);
          applyManifest(nid, { id: nid, windows: [], layout: {} });
          connect(nid);
        }
      }
    },
    [sessions, activeId, ensureCanvas, applyManifest, evictCache, connect],
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
            <RefreshButton spinning={refreshing} disabled={liveHandleCount === 0} onClick={() => void onRefresh()} />
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
        chat={active.chat}
        thinking={active.thinking}
        pendingItems={active.pending}
        width={t.chatWidth}
        inputRef={composerRef}
        onSend={onSend}
        onStop={onStop}
      />
    </div>
  );
}
