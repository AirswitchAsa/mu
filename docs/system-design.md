# µ — System Design (overview)

> The architecture map. Companion to [product.md](./product.md) (the *why*). The component
> and contract detail lives in [data-architecture.md](./data-architecture.md) (the data
> plane) and [agent-integration.md](./agent-integration.md) (the agent plane); this document
> is the map that ties them together. Settled choices are stated plainly; open ones are
> gathered in §7.

---

## 1. The shape of the system

µ is a small set of cooperating components around one idea: **the agent composes the
interface as validated operations; the runtime renders them safely; and data flows through a
typed, named broker so the agent reasons over data without ever carrying it.**

```text
┌─────────────────────────────────────────────────────────────────┐
│ Playground (web)   grid canvas · renderers · chat · user layout   │
└──────────▲────────────────────────────────────────────┬──────────┘
   render windows; resolve handles                        user message
   (full data, server-side)                               + canvas edits
┌──────────┴────────────────────────────────────────────▼──────────┐
│ µ server (one process)                                            │
│   session state · validate & apply canvas ops · provenance        │
│                                                                   │
│   µ-native tool surface                       drives ┌──────────┐ │
│   list · fetch · view  + canvas verbs  ◄─────────────│ opencode │ │
│        │                       tools (plugin)        │ headless │ │
│        ▼                                             └──────────┘ │
│   DataBroker    one shared store · ingest-validate ·              │
│        ▲        merge · resolve · catalog                         │
│        │ ingest (canonical shapes)                                │
│   resource plugins (in-process, thin)   descriptor + fetch         │
│   yfinance · tiingo · orats · …                                    │
│        │ on-demand (agent)        │ cadence (scheduler)            │
└────────┼──────────────────────────┼───────────────────────────────┘
         ▼                          ▼
   external sources (HTTP / CLI / MCP) — credentials held server-side
```

The whole thing runs as **one process** (plus the web frontend), packaged as a Docker image.

---

## 2. Components

- **Playground (web)** — the grid canvas and chat panel. Owns *layout*: the user rearranges
  and resizes; manual placement is sticky; auto-layout fills gaps on an infinitely
  scrolling canvas. Renderers resolve data **handles** server-side and draw the full series.
- **µ server (runtime)** — one process. Holds session state, validates and applies canvas
  operations, records provenance, hosts the tool surface / broker / resource plugins /
  scheduler, and **drives a headless opencode**. → [agent-integration](./agent-integration.md),
  [data-architecture](./data-architecture.md).
- **Agent (opencode, headless)** — reasons and orchestrates behind a thin boundary; calls
  µ's tools; emits an answer plus canvas operations. One µ session ↔ one opencode session;
  authors **content, not layout**; references data **by handle, never by payload**.
  → [agent-integration](./agent-integration.md).
- **DataBroker** — a typed, inspectable store of *named* datasets: ingest-validate, merge,
  resolve, catalog. **One shared store**, no per-session data; named so it never collides
  with a future *brokerage* connector (which would be a resource). → [data-architecture](./data-architecture.md).
- **Resource plugins** — thin data sources, each *declaring a descriptor* and *implementing
  `fetch`* (acquire → normalize to canonical → deposit). In-process and trusted.
  → [data-architecture](./data-architecture.md).
- **Tool surface** — the µ-native verb interface: the three data verbs plus the canvas verbs.
  This is the real agent boundary; opencode is one binding of it.
  → [agent-integration](./agent-integration.md).

---

## 3. The end-to-end loop

```text
user message ─▶ µ runtime ─▶ headless opencode
                 (a compact canvas summary rides along with the message)
                      │
                      ├─ list                     → what sources exist
                      ├─ fetch(source, params)    → µ executes server-side, the resource
                      │                             normalizes + deposits to the broker,
                      │                             the agent gets back a HANDLE + summary
                      ├─ view(handle, slice?)      → a bounded read, only to reason over
                      └─ emit answer + canvas ops  → windows bound to handles
                      ▼
µ runtime validates + applies the canvas ops ─▶ session state (+ provenance)
                      ▼
playground renders/updates windows ─▶ renderers resolve handles from the broker
                                      SERVER-SIDE (full data; never via the agent)
                      ▼
user continues — by talking, or by rearranging/closing windows, which updates the
same session state and is reflected to the agent on its next turn.
```

The two invariants to notice: the agent moves **handles**, not data; and the user's own
canvas edits flow through the same state the agent reads.

---

## 4. Cross-cutting concerns

- **Data-path discipline.** Bulk data never enters the agent's context. The agent fetches by
  reference and reasons over bounded `view`s; renderers get full data server-side. (The
  reasoning behind this drove most of the architecture — see
  [agent-integration §1](./agent-integration.md).)
- **Trust & credentials.** Provider keys live in resource-plugin config, server-side, and
  never reach the agent or the browser. In-process plugins are *trusted code* for now
  (self-hosted, self-installed); worker/sandbox isolation is a later option. The same applies
  to third-party renderers.
- **Provenance.** Every on-screen number should trace to a broker entry, and through it to a
  source; that lineage carries into citations.
- **Two-level tool abstraction.** The µ-native verb interface is the boundary; opencode is
  one binding; an MCP facade is an optional later bolt-on, not the foundation.

---

## 5. Playground & renderers

Settled (now specified in [spec/](./spec/)):
- Responsive grid on an **infinitely scrolling canvas**; user owns layout (sticky manual
  placement, gap-filling then append-below auto-layout); the agent authors content, not layout.
- Renderers are manifest-registered, take a validated spec plus a data handle, and draw;
  **Lightweight Charts** (Apache-2.0) is the base charting primitive. **v0 ships trusted,
  in-core renderers only** — no third-party renderer surface yet, so no sandbox to design.
- User and agent share one canvas operation vocabulary (`apply_canvas_op`), applied by the
  runtime as the single source of truth; the verb signatures are specified.

Deferred: the third-party renderer install mechanism + sandbox/trust model (only when a
non-core renderer surface is opened).

---

## 6. Build sequence

Dashboard-first, so the data model stays demand-driven:

1. Build the canvas and a few real renderers against typed **mock fixtures**.
2. Harvest the data shapes the renderers actually need; formalize them in the data contract.
3. Build the DataBroker and resource plugins.
4. Wire the agent (headless opencode, SDK-spawned, + the `@mu/opencode-plugin`) into the loop.

(This is sequencing, not architecture — order may flex. **v0 is built**: all four are done,
runnable end-to-end with a Vite/React web client.)

---

## 7. Open questions (consolidated)

**Broker internals — now designed in [spec/](./spec/) (DOG).**
- Scope: **resolved — one shared store**, no tiering, no per-session data; a handle is global
  and the broker resolves update races via idempotent fetch + a single write path.
- Persistence: durable on disk (the shared store survives restart); the in-memory cache is hot
  data, rebuilt/evicted as needed.
- Live update: **resolve-on-render for v0**; subscribe/notify is deferred to a separate
  in-broker mechanism.
- `view` slice/guard: **resolved — a strict, small headroom that refuses over-broad reads**
  (exact number deferred); per-shape merge is specified per kind in spec/.

**Frontend — specified in [spec/](./spec/).**
- Auto-layout: **resolved** — infinite scroll-down, gap-fill then append, sticky manual
  placement, no reflow of pinned windows.
- Canvas verb signatures: **specified** (`apply_canvas_op` + the `canvas_*` set).
- Third-party renderer install + sandbox/trust model: **deferred** (v0 is trusted in-core only).

**Agent integration — specified in [spec/](./spec/).**
- opencode driving surface: **built** — µ spawns/supervises opencode via
  `@opencode-ai/sdk`'s `createOpencodeServer` and drives it with `createOpencodeClient`; the
  agent runs yolo (permission all-allow, built-in tools off). Pinned to 1.15.x (pre-1.0).
- Tool descriptions/examples that make the generic verbs unambiguous to the model: still to be
  tuned against a real model (a wording task, not an architecture one).

**Scope — settled.**
- Single-user only (no auth/multi-tenant) — a locked product decision.
- Session save/share: out of v0, build later; the model is built for it (sessions hold
  bindings, broker data is shared and persistent).

**Remaining open.**
- Eviction thresholds for the shared store (LRU + freshness settled; exact caps deferred).
- opencode model selection (maintainer config: default + per-session override).
- Concrete v0 shape record schemas refine as the renderers are built.
