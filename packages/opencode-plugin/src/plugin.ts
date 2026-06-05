import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

/**
 * @mu/opencode-plugin — Level 2 of the tool abstraction (opencode-plugin.dog.md).
 * Surfaces µ's Level-1 verbs as opencode tools; each `execute` forwards to the µ
 * server over localhost HTTP (MU_CALLBACK_URL), routed by `context.sessionID`,
 * returning handles/summaries — never bulk. opencode discovers it via `server`.
 *
 * Self-contained on purpose: it runs inside opencode's process and reaches µ only
 * over HTTP, so it imports nothing from @mu/*.
 */

const z = tool.schema;

/** Bound on a single tool callback (e.g. a data_fetch hitting a slow source). A
 *  hung verb would otherwise stall the agent's whole turn; this surfaces it as a
 *  normal tool error the agent can react to. Override via MU_TOOL_TIMEOUT_MS. */
const TOOL_TIMEOUT_MS = Number(process.env["MU_TOOL_TIMEOUT_MS"] ?? 60_000);

async function call(verb: string, sessionID: string, args: Record<string, unknown>): Promise<unknown> {
  const base = process.env["MU_CALLBACK_URL"];
  if (!base) throw new Error("MU_CALLBACK_URL is not set; the µ endpoint is unknown.");
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = process.env["MU_CALLBACK_TOKEN"];
  if (token) headers["x-mu-internal-token"] = token;
  const resp = await fetch(`${base}/internal/tool/${verb}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionID, args }),
    signal: TOOL_TIMEOUT_MS > 0 ? AbortSignal.timeout(TOOL_TIMEOUT_MS) : undefined,
  });
  const json = (await resp.json()) as { ok?: unknown; error?: { code: string; message: string } };
  if (json.error) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.ok;
}

/** Run a verb, formatting either the result via `fmt` or a typed error as a string. */
async function run(
  verb: string,
  sessionID: string,
  args: Record<string, unknown>,
  fmt: (ok: unknown) => string,
): Promise<string> {
  try {
    return fmt(await call(verb, sessionID, args));
  } catch (err) {
    return `${verb} failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export const server: Plugin = async () => ({
  tool: {
    data_list: tool({
      description:
        "List µ's data capabilities: installed sources (what can be fetched) and already-materialized datasets (metadata only, never bulk). Filter by provider/shape/entity.",
      args: {
        provider: z.string().optional(),
        shape: z.string().optional(),
        entity: z.string().optional(),
      },
      execute: (args, ctx) => run("data_list", ctx.sessionID, args, (ok) => JSON.stringify(ok)),
    }),

    data_fetch: tool({
      description:
        "Fetch a dataset into µ (idempotent). Returns a handle + small summary — never the raw series. Use for any stock price/history request, then bind a window to the handle.",
      args: {
        entity: z.string().describe("ticker symbol, e.g. AMZN"),
        shape: z.string().optional().describe("canonical shape (default ohlcv)"),
        source: z.string().optional().describe("provider id (default yfinance)"),
        resolution: z.string().optional().describe("1d (default) | 1wk | 1mo"),
        range: z.string().optional().describe("5d|1mo|3mo|6mo|1y|2y|5y|max"),
        kind: z.string().optional().describe("news namespace: ticker (per-company) | sector | market (defaulted from the source/feed when omitted)"),
      },
      execute: (args, ctx) =>
        run("data_fetch", ctx.sessionID, args, (ok) => {
          const r = ok as { handle: string; summary: { rowCount?: number; latestClose?: number } };
          return `Fetched ${r.handle}: ${r.summary.rowCount ?? "?"} rows, latest close ${r.summary.latestClose ?? "n/a"}.`;
        }),
    }),

    data_view: tool({
      description:
        "Read a bounded slice of a materialized dataset to reason over values. Over-broad reads are refused (summarized) — bind a window for full data instead.",
      args: {
        handle: z.string(),
        last: z.number().optional().describe("most recent N records"),
        start: z.number().optional().describe("epoch-ms inclusive start"),
        end: z.number().optional().describe("epoch-ms inclusive end"),
      },
      execute: (args, ctx) => {
        const slice: Record<string, unknown> = {};
        if (typeof args.last === "number") slice["last"] = args.last;
        if (typeof args.start === "number" || typeof args.end === "number") {
          slice["timeRange"] = { start: args.start, end: args.end };
        }
        return run(
          "data_view",
          ctx.sessionID,
          { handle: args.handle, slice: Object.keys(slice).length ? slice : undefined },
          (ok) => JSON.stringify(ok),
        );
      },
    }),

    renderer_list: tool({
      description:
        "List the window types you can create (price_chart, compare, memo, …) with each one's spec options and the data shape it requires. For price_chart this includes the full technical-indicator catalog (specSchema.indicatorCatalog: names, params + ranges, placement). Call this before canvas_create/canvas_update so you use a valid type, indicator name, and params.",
      args: {},
      execute: (_args, ctx) => run("renderer_list", ctx.sessionID, {}, (ok) => JSON.stringify(ok)),
    }),

    canvas_create: tool({
      description:
        "Create a typed window on the canvas (call renderer_list first to see types, e.g. price_chart) and optionally bind a data handle. You author content (spec + bindings), never layout. For price_chart, add indicators via spec.indicators (e.g. [{name:'ema',params:{period:50}},{name:'rsi'}]); add/remove them later via canvas_update.",
      args: {
        type: z.string().describe("window type, e.g. price_chart"),
        handle: z.string().optional().describe("data handle to bind"),
        title: z.string().optional(),
        spec: z.any().optional().describe("renderer-specific content spec (see renderer_list)"),
      },
      execute: (args, ctx) =>
        run("canvas_create", ctx.sessionID, args, (ok) => {
          const r = ok as { windowId?: string };
          return `Created window ${r.windowId ?? "?"} (${args.type}).`;
        }),
    }),

    canvas_update: tool({
      description: "Update a window's content spec (merged).",
      args: { windowId: z.string(), spec: z.any() },
      execute: (args, ctx) => run("canvas_update", ctx.sessionID, args, () => `Updated ${args.windowId}.`),
    }),

    canvas_bind: tool({
      description: "Bind a data handle to an existing window.",
      args: { windowId: z.string(), handle: z.string() },
      execute: (args, ctx) => run("canvas_bind", ctx.sessionID, args, () => `Bound ${args.handle} to ${args.windowId}.`),
    }),

    canvas_delete: tool({
      description: "Remove a window from the canvas.",
      args: { windowId: z.string() },
      execute: (args, ctx) => run("canvas_delete", ctx.sessionID, args, () => `Deleted ${args.windowId}.`),
    }),

    canvas_focus: tool({
      description: "Focus a window.",
      args: { windowId: z.string() },
      execute: (args, ctx) => run("canvas_focus", ctx.sessionID, args, () => `Focused ${args.windowId}.`),
    }),

    get_canvas_state: tool({
      description: "Get the full current canvas (windows, specs, bindings, layout) — not dataset payloads.",
      args: {},
      execute: (_args, ctx) => run("get_canvas_state", ctx.sessionID, {}, (ok) => JSON.stringify(ok)),
    }),
  },
});
