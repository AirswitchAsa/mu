import { mkdir } from "node:fs/promises";
import {
  decodeHandle,
  encodeHandle,
  MuErrorException,
  type FetchResult,
  type Handle,
  type MetaJson,
  type Shape,
  type ShapeSummary,
  type ViewResult,
  type ViewSlice,
} from "@mu/protocol";
import { Duck } from "./duck.js";
import { KeyedMutex } from "./mutex.js";
import { ShapeRegistry } from "./shapes/registry.js";
import { Storage } from "./storage.js";

/**
 * The bulk guard's row headroom. Deliberately small (data_view.dog.md): the exact
 * number is a deferred tuning detail, the strictness is not. A slice that would
 * return more than this is refused and summarized, never truncated-and-dumped.
 */
export const VIEW_GUARD_MAX_ROWS = 500;

/**
 * DataBroker — the one shared store (data-broker.dog.md). The single write path
 * (`ingest`, per-handle-atomic) and the two read paths: `resolve` (full, for
 * renderers) and `view` (bounded + guarded, for the agent).
 */
export class DataBroker {
  private readonly locks = new KeyedMutex();

  private constructor(
    private readonly root: string,
    private readonly storage: Storage,
    private readonly shapes: ShapeRegistry,
  ) {}

  static async create(root: string, shapes = new ShapeRegistry()): Promise<DataBroker> {
    await mkdir(root, { recursive: true });
    const duck = await Duck.create();
    return new DataBroker(root, new Storage(root, duck), shapes);
  }

  private shapeFor(shapeId: string): Shape {
    const shape = this.shapes.get(shapeId);
    if (!shape) throw new MuErrorException("VALIDATION_FAILED", `unknown shape: ${shapeId}`);
    return shape;
  }

  private async summaryOf(handle: Handle, shape: Shape): Promise<ShapeSummary> {
    return shape.summarize(await this.storage.read(handle, shape));
  }

  /**
   * The single write path. Validate → merge → persist → meta, atomic per handle.
   * Idempotent: re-ingesting the same identity collapses to a no-op merge.
   * Returns a handle + small summary — never the payload.
   */
  async ingest(fetch: FetchResult): Promise<{ handle: Handle; summary: ShapeSummary }> {
    const { descriptor, payload, provenance } = fetch;
    const shape = this.shapeFor(descriptor.shape);

    const verdict = shape.validate(payload);
    if (!verdict.ok) {
      const detail = verdict.errors
        .slice(0, 5)
        .map((e) => `${e.path || "<root>"}: ${e.message}`)
        .join("; ");
      throw new MuErrorException("VALIDATION_FAILED", `payload failed ${shape.id} schema: ${detail}`);
    }
    const handle = encodeHandle(descriptor.identity);

    return this.locks.runExclusive(handle, async () => {
      await this.storage.sweepTmp(handle);
      await this.storage.merge(handle, shape, payload);

      const summary = await this.summaryOf(handle, shape);
      const meta: MetaJson = {
        handle,
        shape: shape.id,
        kind: shape.kind,
        descriptor,
        provenance,
        freshness: {
          firstT: summary.firstT ?? null,
          lastT: summary.lastT ?? null,
          fetchedAt: provenance.fetchedAt,
        },
        rowCount: summary.rowCount,
        sizeBytes: await this.storage.sizeBytes(handle),
        contractVersion: shape.contractVersion,
      };
      await this.storage.writeMeta(handle, meta);
      return { handle, summary };
    });
  }

  /** Full data for a renderer — no bulk guard; this path never enters agent context. */
  async resolve(handle: Handle, slice?: ViewSlice): Promise<Record<string, unknown>[]> {
    const shape = this.shapeFor(decodeHandle(handle).shape);
    if (!(await this.storage.exists(handle))) {
      throw new MuErrorException("HANDLE_NOT_FOUND", handle);
    }
    return this.storage.read(handle, shape, slice);
  }

  /** Bounded read for the agent. No slice → summary. Over-broad slice → refused + summarized. */
  async view(handle: Handle, slice?: ViewSlice): Promise<ViewResult> {
    const shape = this.shapeFor(decodeHandle(handle).shape);
    if (!(await this.storage.exists(handle))) {
      throw new MuErrorException("HANDLE_NOT_FOUND", handle);
    }
    const summary = await this.summaryOf(handle, shape);
    if (!slice) return { handle, summary, degraded: false };

    const base = await this.storage.count(handle, shape, slice);
    const effective = slice.last !== undefined ? Math.min(base, slice.last) : base;
    if (effective > VIEW_GUARD_MAX_ROWS) {
      return {
        handle,
        summary,
        degraded: true,
        reason:
          `slice would return ${effective} rows (max ${VIEW_GUARD_MAX_ROWS}). ` +
          `Narrow the slice (timeRange/last) or bind a renderer, which gets full data server-side.`,
      };
    }
    const rows = await this.storage.read(handle, shape, slice);
    return { handle, summary, rows, degraded: false };
  }

  /** The dataset half of data_list — meta only, never the data leaves. */
  async list(): Promise<MetaJson[]> {
    return this.storage.listMeta();
  }

  /** One dataset's meta.json (descriptor/provenance/freshness), or null if absent.
   *  Used by refresh to reconstruct the original fetch from a handle. */
  async describe(handle: Handle): Promise<MetaJson | null> {
    return this.storage.readMeta(handle);
  }
}
