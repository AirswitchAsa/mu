# µ — Docker image

`docker.io/spicadust/mu`

A **single self-contained image**. One Node process serves the web client *and* the HTTP/SSE
API on one port, and supervises a bundled [`opencode`](https://opencode.ai) CLI to run the
agent. All persistent state lives under one volume at `/data`. You bring a model key at run
time — **nothing secret is baked into the image**.

---

## Run

```bash
docker run --rm -p 4000:4000 -v mu-data:/data \
  -e MU_MODEL=deepseek/deepseek-v4-pro \
  -e DEEPSEEK_API_KEY=sk-... \
  docker.io/spicadust/mu:latest
```

Open **http://localhost:4000**.

Or with an env file (e.g. a `.env` holding your keys — see [`.env.example`](.env.example)):

```bash
docker run --rm -p 4000:4000 -v mu-data:/data --env-file .env docker.io/spicadust/mu:latest
```

### API-only (no agent)

Leave `MU_MODEL` unset and µ runs without the agent — the data/canvas REST+SSE API still works,
and `POST /message` returns `NO_DRIVER`. Useful for driving the canvas programmatically or for a
keyless demo of the data plane:

```bash
docker run --rm -p 4000:4000 -v mu-data:/data docker.io/spicadust/mu:latest
```

---

## Configuration

All via environment variables. Only the agent pair is required to enable the agent; everything
else has a sensible default baked into the image.

| Var | Default (in image) | Purpose |
| --- | --- | --- |
| `MU_MODEL` | — (unset → API-only) | Agent `provider/model`, e.g. `deepseek/deepseek-v4-pro` |
| `<PROVIDER>_API_KEY` | — | The model provider's key. By convention `DEEPSEEK_API_KEY` for `deepseek/…`, `OPENAI_API_KEY` for `openai/…`, etc. If `MU_MODEL` is set but its key is missing, the container **fails fast at boot** with a clear message. |
| `FINNHUB_API_KEY` | — | Unlocks Finnhub (company news, earnings, key stats) |
| `FRED_API_KEY` | — | Unlocks FRED (US macro releases) |
| `PORT` | `4000` | Port the server listens on (web + API) |
| `HOST` | `0.0.0.0` | Bind address inside the container |
| `MU_DATA_ROOT` | `/data` | Root of **all** persistent state (point a volume here) |
| `MU_TURN_TIMEOUT_MS` | `180000` | Per-agent-turn deadline |
| `MU_WEB_DIR` | `/app/packages/web/dist` | Built web client the server serves (pre-set; rarely change) |

> The model key must come from the environment. µ relocates opencode's storage under
> `MU_DATA_ROOT` so sessions survive restarts, and that relocated home does **not** see a prior
> `opencode auth login`'s `auth.json` — so pass the key here, not via a host login.

### Keyless out of the box

With no keys, the keyless sources still work: **Yahoo Finance** (OHLCV) and **Yahoo/CNBC RSS**
(news). Keyed sources stay dormant until you supply their key.

---

## Persistence (the `/data` volume)

Everything µ keeps lives under `/data`:

```
/data
  <store>          the broker's DuckDB + parquet data
  _sessions/       µ session sidecars (chat transcript, canvas layout)
  opencode/        the agent's own session storage (so turns resume after a restart)
```

Mount a named volume (`-v mu-data:/data`) or a host path (`-v $PWD/mu-data:/data`) to keep
conversations and data across container restarts. Omit it and state is ephemeral.

---

## Ports

The container exposes **one** port (`4000` by default) serving both the web UI and the API.
opencode runs *inside* the container on an ephemeral loopback port — it is never exposed and
needs no mapping.

```bash
docker run -p 8080:4000 ...      # serve on host :8080 instead
docker run -e PORT=9000 -p 9000:9000 ...   # change the in-container port too
```

A `HEALTHCHECK` probes `GET /api/renderers` (always up once listening, even API-only), so
`docker ps` shows `healthy` when µ is ready.

---

## Build it yourself

From a checkout of the repo:

```bash
docker build -t mu .
docker run --rm -p 4000:4000 -v mu-data:/data --env-file .env mu
```

The build is multi-stage: a builder runs `pnpm install` + `tsc --build` + the Vite web build
(same-origin), and the runtime stage is a slim Node image with the pinned `opencode` CLI plus
the built workspace. Pin a different agent CLI with `--build-arg OPENCODE_VERSION=1.15.11`.

Multi-arch: the build resolves the right `opencode` binary by architecture automatically, so it
works on both `linux/amd64` and `linux/arm64`. To build for another arch:

```bash
docker build --platform linux/amd64 -t mu .
```

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Container exits at boot with a key error | `MU_MODEL` is set but its `<PROVIDER>_API_KEY` is empty. Set the key, or unset `MU_MODEL` for API-only. |
| Chat says `NO_DRIVER` on send | Running API-only (no `MU_MODEL`). Add the agent pair to enable chat. |
| Agent turn fails with auth/4xx from the provider | The model key is wrong or lacks quota. Verify `<PROVIDER>_API_KEY`. |
| State doesn't survive restarts | No volume mounted at `/data`. Add `-v mu-data:/data`. |
| `Permission denied` writing `/data` | A host-path mount owned by another uid. The container runs as uid `10001`; `chown` the host dir or use a named volume. |

---

For what µ *is* and local development, see the project [README](README.md).
