import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk";

export interface OpencodeHandle {
  client: ReturnType<typeof createOpencodeClient>;
  url: string;
  close(): Promise<void>;
}

export interface StartOpencodeOptions {
  /** absolute path to the µ plugin module opencode should load. */
  pluginPath: string;
  /** "provider/model", e.g. "deepseek/deepseek-chat". */
  model: string;
  /** the µ reverse-channel base URL the plugin's tools POST to. */
  callbackUrl: string;
}

/**
 * Supervise a headless opencode (opencode-driver.dog.md): spawn an external
 * `opencode serve` via the SDK with our plugin + model configured, and return an
 * SDK client bound to it. The plugin reaches µ through MU_CALLBACK_URL (env is
 * the only channel config.plugin gives us). Lifecycle is tied to `mu start`.
 */
export async function startOpencode(opts: StartOpencodeOptions): Promise<OpencodeHandle> {
  // The plugin (in opencode's process) reads this to find the µ endpoint.
  process.env["MU_CALLBACK_URL"] = opts.callbackUrl;

  const server = await createOpencodeServer({
    config: {
      plugin: [opts.pluginPath],
      model: opts.model,
    },
  });
  const client = createOpencodeClient({ baseUrl: server.url });

  return {
    client,
    url: server.url,
    close: async () => {
      server.close();
    },
  };
}

/** Parse "provider/model" into the prompt body's model shape. */
export function parseModel(model: string): { providerID: string; modelID: string } {
  const idx = model.indexOf("/");
  if (idx < 0) throw new Error(`model must be "provider/model", got '${model}'`);
  return { providerID: model.slice(0, idx), modelID: model.slice(idx + 1) };
}
