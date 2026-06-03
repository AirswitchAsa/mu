# Data: PackageLayout

## Description

The TypeScript monorepo layout these specs imply. µ is **one server process**
plus a web frontend (system-design.md §1), so the packages are a dependency-
ordered decomposition of that process, not separately deployed services. The
guiding cut: **contracts at the bottom, depended on by everything; the agent
binding and the web app at the top, depended on by nothing.** Each package maps
to components/data defined in these specs.

## Fields

- **@mu/protocol** — the pure contracts: `&Handle` + `!encode_handle`,
  `&ResourceDescriptor`, `&FetchResult`, `&Provenance`, `&MetaJson`, `&CanvasOp`,
  `&Window`, `&SessionState`, `&ViewSlice`, the manifests, and the `#Shape`
  interface. Zero runtime deps; everything imports this.
- **@mu/broker** — `#DataBroker`, `#Catalog`, `#Storage`, the `#Shape`
  implementations and their `!ingest` / `!resolve` / merge / `!atomic_write` /
  `!evict_shared_cache` logic.
- **@mu/resource-sdk** — the thin `#Resource` author surface
  (`&ResourceManifest` + `fetch` → `&FetchResult`), plus `#ResourceRegistry`,
  `#AcquisitionCoordinator`, `#CadenceScheduler`. Depends on @mu/protocol.
- **@mu/renderer-sdk** — the `#Renderer` author surface (`&RendererManifest` +
  the spec-in/handle-in → UI contract) and the base **Lightweight Charts**
  primitives. Frontend-side; depends on @mu/protocol.
- **@mu/runtime** — the `#MuServer`, `#SessionStore`, `#Canvas`, `#ToolSurface`,
  and `!apply_canvas_op` / `!inject_canvas_state` / `!get_canvas_state`. Wires
  broker + resources + sessions together. The in-process plugin host.
- **@mu/opencode-plugin** — the `#OpencodePlugin` + `#OpencodeDriver`: the
  opencode binding (custom tools, `!bind_sessions`) over @opencode-ai/plugin and
  @opencode-ai/sdk. The *only* package that knows opencode exists.
- **@mu/web** — the `#WebClient`: grid canvas, chat panel, `#RendererRegistry`,
  `!auto_layout`. Depends on @mu/renderer-sdk + @mu/protocol.
- **@mu/server** — the composition root / entrypoint: boots `#MuServer`, loads
  resource & renderer plugins, serves @mu/web, drives opencode. The Docker
  image's main.

## Notes

- **Tooling (decided):** **pnpm workspaces** for the monorepo, **Turborepo** for
  the task graph, **TypeScript project references** with `tsc`/`tsup` for library
  builds, and **Vite** for the @mu/web app. The µ server targets **Node**;
  opencode runs on Bun but the `#OpencodeDriver` talks to it over the SDK (HTTP)
  via `opencode serve`, so µ's runtime stays decoupled from opencode's. (Revisit
  only if a deployment constraint demands it.)
- **In-process vs. worker plugins (v0):** `#Resource`/`#Renderer` plugins are
  trusted in-process code in v0. A worker/host-boundary variant is later work; the
  SDK surfaces are shaped to permit it without changing author code.
- The dependency arrow points one way: @mu/protocol ← everything; nothing in the
  data plane imports @mu/opencode-plugin or @mu/web. This keeps the BYO-agent
  promise honest — opencode is replaceable at exactly one package.
