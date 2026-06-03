import type { RendererDef } from "@mu/runtime";

/**
 * Core renderer manifests the server advertises to the agent (v0, trusted in-core).
 * The frontend owns the actual renderer *code*; these manifests are the contract
 * the runtime validates agent specs against and the agent negotiates capability
 * from. v0 ships the one shape (`ohlcv`) plus a data-less memo. No validateSpec →
 * specs are accepted permissively until the renderers pin real schemas.
 */
export const coreRenderers: RendererDef[] = [
  {
    manifest: {
      type: "price_chart",
      specSchema: null,
      requiresShape: ["ohlcv"],
      title: "Price chart",
      description: "OHLCV candlesticks with optional volume and moving-average overlays.",
      trust: "core",
    },
  },
  {
    manifest: {
      type: "memo",
      specSchema: null,
      requiresShape: [],
      title: "Memo",
      description: "Markdown analysis written by the agent. No data binding.",
      trust: "core",
    },
  },
];
