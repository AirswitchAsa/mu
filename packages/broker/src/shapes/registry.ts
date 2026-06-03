import type { Shape } from "@mu/protocol";
import { ohlcvShape } from "./ohlcv.js";

/**
 * The shape registry — shape id → `#Shape`. The broker dispatches validate / merge
 * / summarize through this. v0 ships `ohlcv`; new shapes register here.
 */
export class ShapeRegistry {
  private readonly shapes = new Map<string, Shape>();

  constructor(shapes: readonly Shape[] = [ohlcvShape as Shape]) {
    for (const s of shapes) this.shapes.set(s.id, s);
  }

  get(id: string): Shape | undefined {
    return this.shapes.get(id);
  }

  has(id: string): boolean {
    return this.shapes.has(id);
  }
}
