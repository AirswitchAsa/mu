# Component: OpencodeDriver

## Description

The component that **drives a headless opencode** programmatically (agent-
integration.md §5). Because µ owns its own chat + canvas, the `@User` is not in
opencode's TUI — so µ runs opencode as a server and talks to it over its SDK.
The driver spawns/connects the server, creates one opencode session per µ
session, sends user messages as prompts, and streams events back into the
`#WebClient`'s chat panel.

## State

- **server** — a headless opencode server **spawned + supervised by µ via
  `createOpencodeServer({ config })`** (config carries the `#OpencodePlugin` path,
  the model, and the yolo `permission`/`tools` policy — see Notes). The SDK runs
  the process; µ talks to it over the SDK client (not in-process).
- **client** — an **@opencode-ai/sdk** client
  (`createOpencodeClient({ baseUrl })`) bound to that server.
- **sessionMap** — µ session id ↔ opencode session id (established by
  `!bind_sessions`).
- **model** — the `"provider/model"` string, parsed to `{ providerID, modelID }`
  per prompt.

## Events

- **start()** — `createOpencodeServer({ config: { plugin, model, permission,
  tools } })` to spawn opencode with the `#OpencodePlugin`, then
  `createOpencodeClient({ baseUrl })` to connect. (Pass `hostname`/`port` only
  when defined — the SDK mis-binds on `undefined`.)
- **createSession(muSessionId)** — `client.session.create({ body })`; record the
  mapping.
- **prompt(muSessionId, text, extraParts)** —
  `client.session.prompt({ path: { id }, body })` with `body.parts` (the user text
  + the appended `&CanvasSummary` via `!inject_canvas_state`) and
  `body.model: { providerID, modelID }`. Returns the assistant's final text. The
  canvas/data side effects the agent causes do **not** come back through this
  return value — they flow as the agent's tool calls hit the µ tool-callback and
  are republished on µ's own per-session bus (CQRS); the `#MuServer` SSE streams
  them. (`body.format` json_schema is available if structured output is ever
  needed.)
- **deleteSession(muSessionId)** — `client.session.delete({ path: { id } })` on
  teardown.

## Notes

- **Verified surface (June 2026):** `createOpencode({ hostname, port, signal,
  timeout, config }) → { client, server }`; `createOpencodeClient({ baseUrl,
  … })`; `client.session.create/list/get/delete`; `client.session.prompt({ path,
  body })` with `parts` / `model` / `noReply` / `format`;
  `client.event.subscribe()`. `OPENCODE_SERVER_PASSWORD` protects the server
  with HTTP basic auth. Pin the opencode + SDK versions; re-verify the surface
  before depending on it, as it is pre-1.0 and evolving.
  Sources: <https://opencode.ai/docs/server/>, <https://opencode.ai/docs/sdk/>.
- **As built — SDK-spawned + supervised.** µ spawns and supervises opencode via
  `createOpencodeServer({ config })` (not a separate external `opencode serve`
  shell, and not embedded via `createOpencode`), then drives it with
  `createOpencodeClient`. This keeps the µ server runtime-agnostic (opencode runs
  on Bun; µ need not) and isolates the agent process.
- **As built — yolo agent.** Because µ drives opencode headless, an interactive
  approval prompt would only hang; the driver config sets `permission` to `allow`
  for every gate (`edit`/`bash`/`webfetch`/`doom_loop`/`external_directory`) and
  **disables the built-in fs/shell `tools`** (`bash`/`edit`/`write`/`read`/`glob`/
  `grep`/`list`/`patch`/`webfetch`/`todowrite`/`todoread`/`task` → `false`) so the
  agent is confined to µ's own verbs (the `#OpencodePlugin` tools). Tighter than
  "yolo": the agent can touch the canvas through µ and nothing else.
- **Open — model selection:** which provider/model the driver passes in
  `body.model` is `@Maintainer` config, not µ's choice (µ is not an agent
  framework). Proposed: a configured default with per-session override.
