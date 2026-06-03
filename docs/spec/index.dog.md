# Project: mu

## Description

µ ("mu") is a self-hosted, single-user, generative-UI playground for financial
research: an `@Agent` composes the interface as validated operations, the
runtime renders them safely, and data flows through a typed, named `#DataBroker` so
the agent reasons over data without ever carrying it (it moves `&Handle`s, not
payloads).

This DOG model is the **spec layer** for the deferred technical detail. It is
downstream of the settled prose in `docs/` — README.md, product.md,
system-design.md, data-architecture.md, shapes.md, agent-integration.md — which
remains the source of truth for the *why* and the locked decisions. These
primitives formalize the *how* across seven areas: the `#DataBroker` internals
(`!ingest`, `!resolve`, `!atomic_write`, eviction & lifecycle); the data
contract (`&Handle` / `!encode_handle`, `&FetchResult`, `&ResourceDescriptor`,
per-kind merge, `!data_view`'s slice + bulk guard); the resource/plugin contract
(`#Resource`, `#ResourceRegistry`, `#AcquisitionCoordinator`,
`#CadenceScheduler`); agent integration (`#ToolSurface`, `#OpencodePlugin`,
`#OpencodeDriver`, `!inject_canvas_state`); the canvas plane (`#Canvas`,
`&SessionState`, `!apply_canvas_op`); the frontend/renderers (`#Renderer`,
`&RendererManifest`, `!register_renderer`, `!auto_layout`); and the monorepo
`&PackageLayout`.

The v0 implementation now exists and is downstream of this model: a pnpm-workspace
monorepo (`&PackageLayout`) realizing the data plane, runtime, opencode binding, and
HTTP/SSE server, plus a Vite/React `#WebClient`. Where code and spec have diverged,
the divergences are noted on the relevant primitive. Concrete `#Shape` record schemas
are v0/provisional (shapes.md) and refine as renderers are built.

## Actors

- [Agent](actors/agent.dog.md)
- [Maintainer](actors/maintainer.dog.md)
- [User](actors/user.dog.md)

## Behaviors

- [apply_canvas_op](behaviors/apply-canvas-op.dog.md)
- [atomic_write](behaviors/atomic-write.dog.md)
- [auto_layout](behaviors/auto-layout.dog.md)
- [bind_sessions](behaviors/bind-sessions.dog.md)
- [cadence_refresh](behaviors/cadence-refresh.dog.md)
- [data_fetch](behaviors/data-fetch.dog.md)
- [data_list](behaviors/data-list.dog.md)
- [data_view](behaviors/data-view.dog.md)
- [encode_handle](behaviors/encode-handle.dog.md)
- [evict_shared_cache](behaviors/evict-shared-cache.dog.md)
- [get_canvas_state](behaviors/get-canvas-state.dog.md)
- [ingest](behaviors/ingest.dog.md)
- [inject_canvas_state](behaviors/inject-canvas-state.dog.md)
- [merge_cross_section](behaviors/merge-cross-section.dog.md)
- [merge_event_list](behaviors/merge-event-list.dog.md)
- [merge_series](behaviors/merge-series.dog.md)
- [register_renderer](behaviors/register-renderer.dog.md)
- [register_resource](behaviors/register-resource.dog.md)
- [resolve](behaviors/resolve.dog.md)
- [resource_availability](behaviors/resource-availability.dog.md)

## Components

- [AcquisitionCoordinator](components/acquisition-coordinator.dog.md)
- [CadenceScheduler](components/cadence-scheduler.dog.md)
- [Canvas](components/canvas.dog.md)
- [Catalog](components/catalog.dog.md)
- [DataBroker](components/data-broker.dog.md)
- [MuServer](components/mu-server.dog.md)
- [OpencodeDriver](components/opencode-driver.dog.md)
- [OpencodePlugin](components/opencode-plugin.dog.md)
- [Renderer](components/renderer.dog.md)
- [RendererRegistry](components/renderer-registry.dog.md)
- [Resource](components/resource.dog.md)
- [ResourceRegistry](components/resource-registry.dog.md)
- [SessionStore](components/session-store.dog.md)
- [Shape](components/shape.dog.md)
- [Storage](components/storage.dog.md)
- [ToolSurface](components/tool-surface.dog.md)
- [WebClient](components/web-client.dog.md)

## Data

- [CanvasOp](data/canvas-op.dog.md)
- [CanvasSummary](data/canvas-summary.dog.md)
- [FetchResult](data/fetch-result.dog.md)
- [Handle](data/handle.dog.md)
- [MetaJson](data/meta-json.dog.md)
- [PackageLayout](data/package-layout.dog.md)
- [Provenance](data/provenance.dog.md)
- [RendererManifest](data/renderer-manifest.dog.md)
- [ResourceDescriptor](data/resource-descriptor.dog.md)
- [ResourceManifest](data/resource-manifest.dog.md)
- [SessionState](data/session-state.dog.md)
- [ViewSlice](data/view-slice.dog.md)
- [Window](data/window.dog.md)

## Notes

### Decisions resolved with the maintainer

- **`Broker` → `#DataBroker`** — renamed so a future *brokerage* connector (an
  actual trading broker, configured as a `#Resource`) doesn't collide with the
  dataset store.
- **Single shared store — no tiers, no session-private data.** Data is always
  shared: a `&Handle` resolves to the same global dataset for every session.
  This is the whole point of a broker — fetch once, reuse everywhere — and,
  combined with **idempotent fetch + a single write path** (`!ingest` under a
  per-handle mutex, `!atomic_write`), it makes the broker the **resolver of all
  update races** on a handle. The earlier two-tier (shared + per-session
  overlay) model is dropped, and with it the notion of session scratch.
- **Subscribe/notify** — deferred; a separate mechanism designed later **inside**
  the `#DataBroker`. v0 is resolve-on-render only (`!resolve`, `#WebClient`).
- **`!data_view` guard** — no numeric data-size budget fixed yet; the posture is
  what's settled: the `#Shape` developer keeps the view sensible, and the runtime
  enforces a **strict, small** length headroom, **refusing** (summarizing)
  over-broad reads rather than truncating-and-dumping. Raw data must never reach
  the agent's context.
- **Session end** (`!bind_sessions`, `#SessionStore`) — on `session.deleted` µ
  drops the session's `&SessionState` only; **no data is touched** (there is no
  session-private data — see the single-store decision above). Datasets persist
  in the shared store regardless of session lifecycle.
- **Provider selection** (`#ResourceRegistry`) — the **agent's** design choice,
  not a maintainer-curated ranking; µ defaults deterministically when the agent
  doesn't care, and the agent picks from `!data_list` when it does.
- **Acquisition failures** (`#AcquisitionCoordinator`) — **typed errors**
  (`{ code, message }`) in the tool result; never raw vendor errors in context.
- **opencode driving** (`#OpencodeDriver`) — µ supervises opencode via the SDK:
  `createOpencodeServer({config})` spawns it (plugin + model + yolo config) and
  `createOpencodeClient` connects; keeps the µ server runtime-agnostic. The agent
  is run **yolo** — `permission` all-`allow` (headless, no approver) and the
  built-in fs/shell `tools` disabled so it is confined to µ's verbs. Pinned to
  opencode 1.15.x (pre-1.0 surface; re-verify on bump).
- **Renderers** (`!register_renderer`) — v0 ships **trusted, in-core renderers
  only**, built on **Lightweight Charts**; no third-party renderer surface and
  therefore **no sandbox/trust model designed for v0** (later work).
- **Auto-layout** (`!auto_layout`) — decided: **infinite scroll-down** canvas;
  row-major gap-fill, per-type default sizes, sticky manual placement, no reflow
  of pinned windows.
- **Monorepo tooling** (`&PackageLayout`) — pnpm workspaces + TS project
  references (`tsc`) for the backend, with Vitest for tests; Vite owns the web app
  (its own build, outside the root `tsc` graph). No Turborepo. µ server on Node,
  opencode driven over the SDK.
- **`metric` identity** (`#Shape`, shapes.md) — decided: `entity` = the subject
  the number is about, `metricId` = which quantity — one rule for equity
  (`AMZN`/`realized_vol_20d`) and macro (`CPIAUCSL`/`level`), no macro
  special-case.

### Still genuinely open

- **Eviction policy & thresholds** (`!evict_shared_cache`) — store size cap /
  staleness TTL / memory budget. Settled: LRU + freshness, never evict data
  bound by a live `&Window`; exact thresholds deferred (and see the deliberately
  un-budgeted `!data_view` headroom above).
- **opencode model selection** (`#OpencodeDriver`) — which provider/model the
  driver passes is `@Maintainer` config, not µ's choice; proposed default +
  per-session override.
- **Concrete `#Shape` record schemas** — v0/provisional (shapes.md), refine as
  the renderers are built.
