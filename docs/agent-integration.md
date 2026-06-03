# µ — Agent Integration (the agent plane)

> How the agent reaches the data plane and the canvas. The data contracts themselves live in
> [data-architecture.md](./data-architecture.md); this document is about the *boundary* — the
> tool surface, the data-path discipline, and how µ drives opencode. Settled unless marked
> **Open**.

---

## 1. The data-path discipline (the load-bearing constraint)

The single rule that shapes everything else: **bulk data must never flow through the agent's
context window.**

The "MCP plugged into an agent" idiom assumes a tool's result *is* what the model reads —
output flows into context. µ wants the opposite: a fetch puts data in the broker, and the
agent gets a **handle**. A year of daily bars is borderline in a context window; an options
chain or an intraday series is impossible — and routing data through the model defeats the
broker's entire purpose.

So acquisition is **agent-initiated but server-executed**: the agent decides *what* to fetch;
µ executes the fetch server-side; the agent receives a handle + a small summary, not the
payload. The agent then either binds a window to the handle (and the renderer draws the full
data server-side) or `view`s a bounded slice when it needs to reason over values. Small,
reasoning-relevant scalars (a latest close, five headlines) may ride back inline in a summary;
bulk/series/cross-section data does not.

---

## 2. The two-level tool abstraction

- **Level 1 — the µ-native verb interface.** The real agent boundary, and runtime-agnostic.
  It is the three data verbs (`list` / `fetch` / `view`, see
  [data-architecture §4](./data-architecture.md)) plus the canvas verbs (§3). Everything µ
  exposes to *any* agent is defined here.
- **Level 2 — the opencode binding.** A thin adapter (`@mu/opencode-plugin`) that surfaces the
  Level-1 verbs as opencode tools (§5). If we ever want interop, the *same* Level-1 interface
  can be wrapped in an **MCP facade** — a later bolt-on, not the foundation.

MCP is therefore **not load-bearing**. The contract is µ's own tool surface; the BYO-agent
promise is honored by *documenting that surface*, and opencode is simply its first binding.

---

## 3. The tool surface

Two small families of verbs, each universal and parameterized:

- **Data verbs** — `list`, `fetch`, `view` (defined in
  [data-architecture §4](./data-architecture.md)).
- **Canvas verbs** — create / update / delete / focus / bind a window, with one asymmetry:
  **the agent authors content, not layout.** Layout belongs to the user and the auto-layout
  engine. *(Exact signatures: Open.)*

The user and the agent funnel through the *same* canvas operation vocabulary, applied by the
runtime as the single source of truth — so user edits and agent operations reconcile the same
way.

---

## 4. Acquisition flow

```text
agent → fetch(source, params)                 (a µ tool)
          │
          ▼
   acquisition coordinator (µ server)  ── routes to the resource, runs fetch SERVER-SIDE
          │
          ▼
   resource.fetch → normalize → broker.ingest(handle, shape, payload, provenance)  [validates]
          │
   agent ◄┘   returns a HANDLE + small summary  (never the payload)
          │
   agent → canvas op: bind a window to the handle
   renderer → resolve(handle) from the broker, server-side → draws full data
```

The agent's intelligence touches data through the *summary* and through bounded `view`s — not
the payload.

---

## 5. Driving opencode

Because µ owns the frontend (its own chat + canvas), the user is not sitting in opencode's
TUI. So **µ drives a headless `opencode serve`** programmatically: it connects with
`@opencode-ai/sdk` via `createOpencodeClient({ baseUrl })`, with the `@mu/opencode-plugin`
loaded. One **µ session ↔ one opencode session**.

> **Resolved (verified June 2026):** µ connects to a µ-supervised external `opencode serve`
> (rather than embedding via `createOpencode`), keeping the µ server runtime-agnostic. Surface:
> `createOpencodeClient` · `client.session.create/prompt/delete` (prompt body: `parts` / `model`
> / `noReply` / `format`) · `client.event.subscribe()` SSE. opencode is pre-1.0 — pin versions
> and re-verify. Full detail in [spec/](./spec/components/opencode-driver.dog.md).

### The `@mu/opencode-plugin`

opencode supports custom tools and plugins via `@opencode-ai/plugin` (a tool is
`tool({ description, args /* Zod */, async execute(args, context) })`; a plugin is an async
function returning hooks and tools). µ ships a plugin that:

- **registers the Level-1 verb surface** as opencode tools — each tool's `execute` simply
  forwards to the µ runtime (in-process / localhost), returning handles and summaries;
- **binds sessions** via `session.created` / `session.deleted` hooks (the µ session ↔ opencode
  session mapping);
- optionally uses `tool.execute.before/after` to stream tool traces into the chat panel.

`execute`'s context carries `sessionID`, so each tool call routes to the correct µ session and
its broker. The tool *definitions* are stateless; the session state lives in µ.

No MCP is involved in this path — tools call straight into µ, which is exactly the data-path
discipline of §1.

---

## 6. Canvas state in the agent's context

The agent needs awareness of the current canvas (so it doesn't duplicate a window the user
made, or reference one they closed), but the full state should not bloat every turn. So:

- **A cheap summary, always present** — window ids, types, titles, and the handle each is
  bound to — rides along with the user message.
- **Full detail on request** — a `get_canvas_state` tool the agent calls only when it needs
  specifics.

Append the summary; fetch the detail. This keeps the context lean while preventing the agent
from acting on a stale model.

---

## 7. Status

The boundary is now specified in [spec/](./spec/):
- opencode driving surface: **resolved** — external `opencode serve` over the SDK (see above).
- Canvas verb signatures: **specified** — `apply_canvas_op` + the `canvas_*` set
  ([spec](./spec/behaviors/apply-canvas-op.dog.md)).
- Still owed (a tuning task, not architecture): tool descriptions/examples good enough that the
  generic verbs are unambiguous to the model.
