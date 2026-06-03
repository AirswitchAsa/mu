import { useState } from "react";
import type { SessionMeta } from "./sessionStore";

// =============================================================================
// µ — session rail (left). Slim, expands on hover/focus (state-controlled so a
// pick can force it collapsed). Right-click a session to rename (inline) or
// delete it. Floats over the canvas.
// =============================================================================

const marker = (name: string): string =>
  name.replace(/[^a-z0-9 ]/gi, "").trim().slice(0, 2).toLowerCase() || "··";

export function SessionRail(props: {
  sessions: SessionMeta[];
  activeId: string;
  counts: Record<string, number>;
  expanded: boolean;
  onHover: (v: boolean) => void;
  onPick: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}): JSX.Element {
  const { sessions, activeId, counts, expanded, onHover, onPick, onNew, onRename, onDelete } = props;
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const openMenu = (e: React.MouseEvent, id: string): void => {
    e.preventDefault();
    setMenu({ id, x: e.clientX, y: e.clientY });
  };
  const startRename = (s: SessionMeta): void => {
    setEditingId(s.id);
    setDraft(s.name);
    setMenu(null);
  };
  const commitRename = (id: string): void => {
    const name = draft.trim();
    if (name) onRename(id, name);
    setEditingId(null);
  };

  return (
    <nav
      className="mu-rail"
      aria-label="sessions"
      data-expanded={expanded || undefined}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHover(false);
      }}
    >
      <div className="mu-rail__inner">
        <div className="mu-rail__label ds-spec">sessions</div>
        <ul className="mu-rail__list">
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                className="mu-rail__item"
                data-active={s.id === activeId}
                onClick={() => onPick(s.id)}
                onContextMenu={(e) => openMenu(e, s.id)}
                title={s.name}
              >
                <span className="mu-rail__marker" data-status={s.status}>
                  {marker(s.name)}
                </span>
                {editingId === s.id ? (
                  <input
                    className="mu-rail__rename"
                    autoFocus
                    value={draft}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commitRename(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename(s.id);
                      } else if (e.key === "Escape") {
                        setEditingId(null);
                      }
                    }}
                  />
                ) : (
                  <span className="mu-rail__name">{s.name}</span>
                )}
                <span className="mu-rail__count ds-spec">{counts[s.id] ? counts[s.id] : "—"}</span>
              </button>
            </li>
          ))}
        </ul>
        <button className="mu-rail__new" onClick={onNew}>
          <span className="mu-rail__marker mu-rail__marker--new" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <span className="mu-rail__name">new session</span>
        </button>
      </div>

      {menu && (
        <>
          <div className="mu-ctx__scrim" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            className="mu-ctx"
            style={{ left: Math.min(menu.x, window.innerWidth - 196), top: Math.min(menu.y, window.innerHeight - 104) }}
          >
            <button
              className="mu-ctx__item"
              onClick={() => {
                const s = sessions.find((x) => x.id === menu.id);
                if (s) startRename(s);
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              Rename
            </button>
            <div className="mu-ctx__sep" />
            <button
              className="mu-ctx__item mu-ctx__item--danger"
              onClick={() => {
                onDelete(menu.id);
                setMenu(null);
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Delete session
            </button>
          </div>
        </>
      )}
    </nav>
  );
}
