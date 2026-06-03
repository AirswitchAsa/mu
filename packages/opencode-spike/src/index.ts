// @mu/opencode-spike — throwaway de-risking of the opencode CQRS round-trip.
// Graduates into @mu/opencode-plugin once the loop is proven.
export { startMuEndpoint, type MuEndpoint, type ToolCall, type ToolHandler } from "./mu-endpoint.js";
export { startOpencode, parseModel, type OpencodeHandle, type StartOpencodeOptions } from "./supervisor.js";
