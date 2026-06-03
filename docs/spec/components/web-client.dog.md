# Component: WebClient

## Description

The playground frontend (system-design.md §2), built as **@mu/web** (Vite +
React + TS): a slim hover/click session **rail** (left), a dot-grid **canvas** of
draggable/resizable windows (middle), and a **chat panel** (right). It is the
`@User`'s window into a session — it renders the `#Canvas`'s windows, shows the
conversation, and is where the `@User` exercises layout authority. It owns
*layout*; it does not own *state* (that is the `#SessionStore` server-side).

## State

- **manifest** — the last server-authoritative `&SessionState` (canvas) per
  session; the client diffs each new one against it (see Events).
- **grid** — window placements from the manifest `layout`, rendered onto a 12-col
  grid ↔ pixels; the `@User` drags/resizes (sticky manual placement), and
  `!auto_layout` fills gaps server-side for new content.
- **renderers** — a **client renderer registry**: `src/renderers/*/index.ts`
  plugins (`{ type, mount(el, ctx) → { update, retheme, destroy } }`) glob-
  registered by `type`. The server `&RendererManifest` is authoritative for which
  types/specs are valid; this map supplies the *draw code* (Lightweight Charts).
  Each window is wrapped in an error boundary so one bad spec can't blank the app.
- **rail** — a client-owned session list (names + status in `localStorage`)
  mapped onto live server session ids; a stale id (server restart) is re-created
  on demand. Right-click to rename/delete.
- **chat** — the transcript: user bubbles, assistant prose rendered as **markdown**,
  and an **ops-trace** (the agent's data/canvas verbs) streamed live during the
  turn and attached to the finished message. Restored on open from
  `GET /api/sessions/:id/messages`.

## Events

- **userMessage(text)** — `POST /api/sessions/:id/message` (SSE); the stream
  carries `tool`/`canvas`/`chat`/`done`/`error` events.
- **applyManifest(state)** — on every `canvas` SSE event (and on load) the client
  runs a pure `reconcile(prev, next)` over the **full** server manifest →
  `{ added, removed, updated(specChanged/bindingsChanged), layoutChanged }`, and
  resolves data (`!resolve`) only for added/rebound handles (cached by handle).
  This is the core of the client (`src/lib/manifest.ts`).
- **layoutEdit(windowId, placement)** — drag/resize snaps to the grid on drop and
  POSTs a `move`/`resize` `&CanvasOp` (only the `@User` may); close = a user
  `delete` op (optimistic local patch).

## Notes

- **Server-authoritative manifest, client reconciles.** Every canvas change ships
  the *full* `&SessionState`; the client never replays ops, it diffs. An unchanged
  binding never re-resolves. (Confirmed design decision.)
- Renderers resolve handles **server-side** and receive full data; the client
  never pulls bulk data through the agent path.
- **Baked, toggleable indicators; no agent compute in v0.** SMA/EMA/volume live in
  the chart renderers and the agent toggles them via window `spec`.
- **Live updates deferred:** v0 is resolve-on-render only; window auto-refresh
  waits on the DataBroker's later internal pub/sub (see `#DataBroker`). Session
  state is in-memory server-side (survives reload, not a server restart).
- Layout is the `@User`'s exclusive authority; the `@Agent` authors content via
  `&Window`, never placement.
