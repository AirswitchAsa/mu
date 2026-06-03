# Component: OpencodeDriver

## Description

The component that **drives a headless opencode** programmatically (agent-
integration.md §5). Because µ owns its own chat + canvas, the `@User` is not in
opencode's TUI — so µ runs opencode as a server and talks to it over its SDK.
The driver spawns/connects the server, creates one opencode session per µ
session, sends user messages as prompts, and streams events back into the
`#WebClient`'s chat panel.

## State

- **server** — a headless **`opencode serve`** process exposing the HTTP/SSE
  API (the chosen path; see Notes). µ connects to it as a client rather than
  embedding opencode in-process.
- **client** — an **@opencode-ai/sdk** client
  (`createOpencodeClient({ baseUrl })`) bound to that server.
- **sessionMap** — µ session id ↔ opencode session id (established by
  `!bind_sessions`).

## Events

- **start()** — connect to the `opencode serve` endpoint via
  `createOpencodeClient({ baseUrl })`, with the `#OpencodePlugin` loaded by that
  opencode process. (µ supervises/launches the `serve` process but talks to it
  over the SDK, not in-process.)
- **createSession(muSessionId)** — `client.session.create({ body })`; record the
  mapping.
- **prompt(muSessionId, text)** — `client.session.prompt({ path: { id }, body })`
  with `body.parts` (the user text + the appended `&CanvasSummary`) and
  `body.model: { providerID, modelID }`. `body.format` (json_schema) is
  available if structured output is ever needed.
- **stream()** — consume `client.event.subscribe()` SSE
  (`for await (const event of events.stream)`): tool traces and assistant
  message parts route to the right µ session's chat.
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
- **Decided — connect to `opencode serve`.** µ drives an external (µ-supervised)
  `opencode serve` process over the SDK rather than embedding opencode via
  `createOpencode`. This keeps the µ server runtime-agnostic (opencode runs on
  Bun; µ need not), isolates the agent process, and matches how opencode is
  meant to be operated headless. `OPENCODE_SERVER_PASSWORD` guards the endpoint.
- **Open — model selection:** which provider/model the driver passes in
  `body.model` is `@Maintainer` config, not µ's choice (µ is not an agent
  framework). Proposed: a configured default with per-session override.
