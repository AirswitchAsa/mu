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
- **@mu/runtime** — the `#MuServer` (`#MuRuntime`), `#SessionStore`, `#Canvas`,
  `#RendererRegistry`, `#ToolSurface`, and `!apply_canvas_op` /
  `!inject_canvas_state` / `!get_canvas_state`. Wires broker + resources +
  sessions together with a per-session event bus. The in-process plugin host.
- **@mu/opencode-plugin** — the `#OpencodePlugin` + `#OpencodeDriver`: the
  opencode binding (custom tools, `!bind_sessions`) over @opencode-ai/plugin and
  @opencode-ai/sdk. The *only* package that knows opencode exists.
- **@mu/server** — the composition root / entrypoint: boots `#MuRuntime`, loads
  resource plugins, **registers the core `&RendererManifest`s + spec validators**
  (`core-renderers.ts`: `price_chart`, `compare`, `memo`), serves @mu/web, drives
  opencode. The Docker image's main.
- **@mu/web** — the `#WebClient`: grid canvas, chat panel, session rail, and the
  client-side renderer plugins (`src/renderers/*`, glob-registered by `type`,
  built on **Lightweight Charts**). Depends on @mu/protocol. *(The originally
  planned `@mu/renderer-sdk` was folded in: the authoritative manifests/validators
  live in @mu/server and the draw-code plugins live here.)*

## Notes

- **Tooling (as built):** **pnpm workspaces** for the monorepo, **TypeScript
  project references** with `tsc` for the backend library builds, **Vitest** for
  tests, and **Vite** for the @mu/web app (its own build, outside the root `tsc`
  graph). No Turborepo. The µ server targets **Node**; the `#OpencodeDriver`
  spawns + supervises opencode via the SDK (`createOpencodeServer`) and talks to
  it over the SDK client, so µ's runtime stays decoupled from opencode's.
- **Spike package:** `@mu/opencode-spike` is a throwaway kept only for its
  opencode-integration stress test; it is not part of the dependency graph above.
- **In-process vs. worker plugins (v0):** `#Resource`/`#Renderer` plugins are
  trusted in-process code in v0. A worker/host-boundary variant is later work; the
  SDK surfaces are shaped to permit it without changing author code.
- The dependency arrow points one way: @mu/protocol ← everything; nothing in the
  data plane imports @mu/opencode-plugin or @mu/web. This keeps the BYO-agent
  promise honest — opencode is replaceable at exactly one package.
