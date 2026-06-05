// @mu/protocol — pure contracts. Zero runtime deps; everything imports this.
export type { StructuralKind } from "./kind.js";
export type { Handle, Identity } from "./handle.js";
export { encodeHandle, decodeHandle, handleToPath, pathToHandle } from "./handle.js";
export type { Provenance, AcquisitionTrigger } from "./provenance.js";
export type { ResourceDescriptor } from "./descriptor.js";
export type { FetchResult } from "./fetch-result.js";
export type { MetaJson, Freshness } from "./meta-json.js";
export type {
  Shape,
  ShapeSummary,
  MergeSpec,
  ColumnSpec,
  ColumnType,
  ValidationResult,
  ValidationError,
} from "./shape.js";
export type { ViewSlice, ViewResult } from "./view.js";
export type {
  ResourceManifest,
  ResourceParam,
  ResourceAvailability,
  RendererManifest,
  RendererTrust,
} from "./manifests.js";
export type { MuError, MuErrorCode } from "./errors.js";
export { MuErrorException } from "./errors.js";
export type { Window, Placement, PlacementPatch } from "./window.js";
export type { CanvasOp, Emitter, TraceLine } from "./canvas-op.js";
export { isLayoutOp, LAYOUT_OPS, traceFromOp } from "./canvas-op.js";
export type {
  IndicatorPlacement,
  IndicatorParam,
  IndicatorDef,
  IndicatorSpec,
  IndicatorValidation,
} from "./indicators.js";
export { INDICATORS, INDICATOR_BY_NAME, validateIndicators, resolveIndicatorParams } from "./indicators.js";
export type { SessionState, CanvasState, ChatMessage, ProvenanceEntry, TurnItem } from "./session.js";
export type { TimelineState, TimelineEventInput } from "./turn-timeline.js";
export { emptyTimeline, applyTimelineEvent, buildTimeline } from "./turn-timeline.js";
export type { CanvasSummary, CanvasSummaryWindow } from "./canvas-summary.js";
