# Component: WebClient

## Description

The playground frontend (system-design.md §2), built as **@mu/web** (Vite +
React + TS): a slim hover/click session **rail** (left), a dot-grid **grid
dashboard** of cards (middle), and a **chat panel** (right). It is the `@User`'s
window into a session — it renders the `#Canvas`'s windows as cards, shows the
conversation, and is where the `@User` exercises layout authority. It owns
*layout*; it does not own *state* (that is the `#SessionStore` server-side).

## State

- **manifest** — the last server-authoritative `&SessionState` (canvas) per
  session; the client diffs each new one against it (see Events).
- **grid** — a **responsive card dashboard**, not free-floating windows. The
  client decides the column count from the available width (`colsForWidth`, ~3 on
  a desktop, clamped 2–4) and each card spans cells per a universal **S/M/L/XL**
  size ladder (S=1×1, M=1×2, L=2×2, XL=3×3 in `src/lib/grid.ts`); the board flows
  from the sizes (`grid-auto-flow: dense`). A card's size is its manifest
  `&Placement` `colSpan`×`rowSpan` (the backend `GRID_COLS` is now 3 = XL); the
  `@User` steps it with the card's − / + (a `resize` op) and drags the bar to
  reorder (a `reorder` op). `!auto_layout` still assigns a non-overlapping default
  for new content.
- **renderers** — a **client renderer registry**: `src/renderers/*/index.ts`
  plugins (`{ type, mount(el, ctx) → { update, retheme, destroy } }`) glob-
  registered by `type`. The server `&RendererManifest` is authoritative for which
  types/specs are valid; this map supplies the *draw code* (Lightweight Charts).
  Each card is wrapped in an error boundary so one bad spec can't blank the app.
  `news` + `releases` are drawn as React card bodies from baked sample data (their
  live data plane is deferred — see `#Renderer`).
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
- **sizeStep(windowId, size)** — the card − / + maps a size index to the ladder's
  spans and POSTs a `resize` `&CanvasOp` (user-only; optimistic local patch).
- **reorder(dragId, targetId, after)** — dragging a card's bar reorders the cards
  live (optimistic), then a single `reorder` `&CanvasOp` persists the final order
  on drop. Close = a user `delete` op. (`move` exists in the contract but the grid
  flow no longer uses absolute col/row positioning.)

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
