# syntax=docker/dockerfile:1
#
# µ — single self-contained image. One process (packages/server) serves BOTH the API/SSE
# and the built web client on one port, and supervises a bundled `opencode` CLI for the
# agent. All runtime state (broker store, session sidecars, opencode's own storage) lives
# under one volume at /data (MU_DATA_ROOT). Secrets are NEVER baked in — pass the model key
# and resource keys at `docker run` time (-e / --env-file).
#
#   docker build -t mu .
#   docker run --rm -p 4000:4000 -v mu-data:/data \
#     -e MU_MODEL=deepseek/deepseek-v4-pro -e DEEPSEEK_API_KEY=... mu
#   # then open http://localhost:4000
#
# Leaving MU_MODEL unset runs API-only (no agent; /message returns NO_DRIVER).

ARG NODE_IMAGE=node:22-bookworm-slim
# The opencode CLI the @opencode-ai/sdk spawns (`opencode serve`). Pinned to match the SDK
# (packages/opencode-plugin depends on @opencode-ai/sdk 1.15.5). Bump deliberately.
ARG OPENCODE_VERSION=1.15.11

# ---- builder: install the whole workspace and build TS + the web bundle ------------------
FROM ${NODE_IMAGE} AS builder
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /app
# Whole repo (minus .dockerignore). pnpm needs every workspace package.json present to
# resolve `workspace:*` links; a manifest-only copy buys little here and risks drift.
COPY . .
RUN pnpm install --frozen-lockfile
# tsc --build compiles every referenced project (packages/* + resources/*).
RUN pnpm build
# Build the SPA same-origin: empty VITE_MU_API → the client calls a relative `/api`, so the
# server can serve it off its own origin with no CORS (see packages/web/src/lib/api.ts).
RUN VITE_MU_API= pnpm build:web

# ---- runtime: slim image with the opencode binary + the built workspace ------------------
FROM ${NODE_IMAGE} AS runtime
ARG OPENCODE_VERSION
ENV NODE_ENV=production
# The opencode CLI binary on PATH (the SDK launches `opencode serve` via cross-spawn). The
# npm package resolves the right prebuilt platform binary from its optionalDependencies.
RUN npm i -g opencode-ai@${OPENCODE_VERSION} && npm cache clean --force
WORKDIR /app
# Bring the fully-built, fully-installed workspace over. pnpm's virtual store
# (node_modules/.pnpm) holds the real files, so /app is self-contained — the resources'
# runtime deps (e.g. yahoo-finance2), loaded by dynamic import at request time, come along.
COPY --from=builder /app /app

# One process serves web + API on $PORT; one /data volume holds ALL state. opencode's config
# & cache go under a writable HOME; its DATA home is repinned to /data/opencode by the driver.
ENV PORT=4000 \
    HOST=0.0.0.0 \
    MU_DATA_ROOT=/data \
    MU_RESOURCES_DIR=/app/resources \
    MU_WEB_DIR=/app/packages/web/dist \
    HOME=/home/mu \
    XDG_CONFIG_HOME=/home/mu/.config \
    XDG_CACHE_HOME=/home/mu/.cache

# Non-root. The data volume and the agent's writable home are owned by the runtime user.
RUN useradd --system --create-home --home-dir /home/mu --uid 10001 mu \
 && mkdir -p /data /home/mu/.config /home/mu/.cache \
 && chown -R mu:mu /data /home/mu /app
USER mu
VOLUME ["/data"]
EXPOSE 4000

# Liveness: the renderers endpoint is always up once the server is listening (no agent/key
# needed), so it's a clean readiness probe that works in API-only mode too.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/renderers').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/main.js"]
