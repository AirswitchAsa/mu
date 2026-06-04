# µ — Backend HTTP API (v0)

> The integration seam between the µ server (`@mu/server`) and the web frontend.
> This is the contract the design side builds against. It is a conventional
> REST + SSE API, CORS-open for local dev (frontend on its own dev server).
> Defined by the backend; tell us if the UI needs a different shape.

The server is **one process**. Run it from the repo root:

```bash
pnpm build
MU_MODEL=deepseek/deepseek-chat PORT=4000 pnpm start
# → µ server listening on http://127.0.0.1:4000
```

Env: `PORT` (4000) · `MU_DATA_ROOT` (`./.mu-data`) · `MU_RESOURCES_DIR` (`./resources`) ·
`MU_MODEL` (`deepseek/deepseek-chat`; needs that provider authed in opencode).
Omit `MU_MODEL` to run API-only (no agent; `/message` returns `NO_DRIVER`).

All responses are JSON unless noted. Errors are `{ "error": { "code", "message" } }`
with `code` from the typed set (`VALIDATION_FAILED`, `HANDLE_NOT_FOUND`,
`NOT_CONFIGURED`, `RATE_LIMITED`, `FETCH_FAILED`, …). Raw vendor errors never appear.

## Sessions

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/sessions` | — | `{ sessionId }` (also creates the opencode session) |
| `DELETE` | `/api/sessions/:id` | — | `{ ok: true }` (drops session state; **no broker data touched**) |

## Canvas

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/sessions/:id/canvas` | — | `CanvasState`: `{ id, windows[], layout, focusedWindowId? }` |
| `GET` | `/api/sessions/:id/messages` | — | `{ messages: ChatMessage[] }` — chat history for reload-restore (`{ role, text, at }`) |
| `GET` | `/api/sessions/:id/title` | — | `{ title: string \| null }` — opencode's auto-generated session title (null if unset / no driver) |
| `POST` | `/api/sessions/:id/canvas/ops` | `{ ops: CanvasOp[] }` | `{ summary }` — **user** ops (incl. `move`/`resize`/`reorder`) |

`Window`: `{ id, type, title, spec, bindings: Handle[], provenanceRefs }`.
`layout[windowId]`: `{ col, row, colSpan, rowSpan, pinned }`. The user owns layout;
agent ops that try `move`/`resize`/`reorder` are rejected. The web client lays the
canvas out as a responsive **grid dashboard**: card size = `colSpan`×`rowSpan` on
an S/M/L/XL ladder (backend grid is 3 cols), and `reorder(windowId, targetId,
after)` moves a window before/after a target in window order.

> Session state (canvas + messages) is **in-memory** in v0: it survives a browser
> reload (re-fetch canvas + messages) but **not a server restart**. The web client
> maps its own localStorage session list onto live ids and re-creates a stale id.

## Message (SSE)

```
POST /api/sessions/:id/message     body: { text }
Content-Type: text/event-stream
```

Each line is `data: <json>`. Event shapes:

```jsonc
{ "type": "canvas", "op": <CanvasOp>, "state": <CanvasState> }  // FULL manifest, streamed live as the agent edits
{ "type": "tool", "verb": "data_fetch", "arg": "AMZN · 1d", "ret": "yfinance:ohlcv:AMZN:1d · 252 rows" }  // a data verb the agent ran
{ "type": "chat", "role": "assistant", "text": "..." }          // assistant reply (turn end)
{ "type": "done" }                                               // turn complete — stop reading
{ "type": "error", "error": { "code", "message" } }
```

The agent drives the canvas by calling tools (not structured output). **The canvas
is server-authoritative**: every change emits a `canvas` event carrying the *full*
`CanvasState` (the playground manifest). The client keeps the last manifest, diffs
the new one against it, and patches only what changed — windows added/removed,
specs updated, bindings rebound — so an unchanged binding never re-resolves. `op`
rides along only as a hint for the chat ops-trace. `tool` events surface the data
verbs (`data_fetch`/`data_view`/`data_list`) for that same trace; they never carry
bulk. The cheap canvas summary is auto-injected into every turn, so the agent stays
aware of the current canvas.

## Renderer data path (full data, server-side)

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/resolve?handle=<handle>` | `{ handle, rows: Record[] }` — **full** series for a renderer |

Renderers resolve a window's bound `Handle` here and draw the complete data. This
path is deliberately unguarded (unlike the agent's `data_view`) — it never enters
the agent's context. Note: time `t` is **epoch-ms**; Lightweight Charts wants
epoch-**seconds**, so divide by 1000 in the renderer.

## Capability / catalog

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/renderers` | `{ renderers: RendererManifest[] }` — window types the agent may request |
| `GET` | `/api/data/list?provider=&shape=&entity=` | `{ sources[], datasets[] }` — installed sources + catalogued datasets (metadata only) |

## Internal (not for the frontend)

`POST /internal/tool/:verb` is the localhost callback the opencode plugin uses to
reach the runtime (`data_*`, `canvas_*`, `get_canvas_state`, `renderer_list`).
Frontends ignore it. The agent calls `renderer_list` to discover the window types
it may create, each one's `spec` options, and the data shape it requires — the same
manifests `GET /api/renderers` advertises to the web client.
