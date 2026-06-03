import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

/**
 * The µ opencode plugin (spike). Loaded by opencode (Bun) via config.plugin. It
 * exposes µ's verbs as opencode tools whose `execute` forwards to the µ server
 * over localhost HTTP (MU_CALLBACK_URL) — never returning bulk data, only a
 * handle + summary. `context.sessionID` routes to the right µ session.
 *
 * opencode discovers the plugin via the exported `server` (PluginModule.server).
 */
export const server: Plugin = async () => {
  return {
    tool: {
      data_fetch: tool({
        description:
          "Fetch OHLCV price/volume history for a stock ticker into µ. Returns a handle " +
          "and a small summary (row count, latest close) — never the raw series. " +
          "You MUST call this tool for any request about a stock's price or history.",
        args: {
          entity: tool.schema.string().describe("ticker symbol, e.g. AMZN"),
          source: tool.schema.string().optional().describe("optional provider id (defaults to yfinance)"),
        },
        async execute(args, context) {
          const base = process.env["MU_CALLBACK_URL"];
          if (!base) return "ERROR: MU_CALLBACK_URL is not set; µ endpoint unknown.";
          const resp = await fetch(`${base}/tool/data_fetch`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionID: context.sessionID, args }),
          });
          const json = (await resp.json()) as {
            ok?: { handle: string; summary: { rowCount: number; latestClose?: number } };
            error?: { code: string; message: string };
          };
          if (json.error) return `data_fetch failed: ${json.error.code} — ${json.error.message}`;
          const { handle, summary } = json.ok!;
          return `Fetched ${handle}: ${summary.rowCount} bars, latest close ${summary.latestClose ?? "n/a"}.`;
        },
      }),
    },
  };
};
