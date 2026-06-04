import type { Shape } from "@mu/protocol";
import { ohlcvShape } from "./ohlcv.js";
import { newsShape } from "./news.js";
import { releasesShape } from "./releases.js";
import { keyStatsShape } from "./key-stats.js";

/**
 * The core shapes the broker ships with: ohlcv (series), news (event-list),
 * releases (point-in-time), key_stats (cross-section).
 */
export const CORE_SHAPES: readonly Shape[] = [
  ohlcvShape as Shape,
  newsShape as Shape,
  releasesShape as Shape,
  keyStatsShape as Shape,
];

/**
 * The shape registry — shape id → `#Shape`. The broker dispatches validate / merge
 * / summarize through this. Ships the core shapes; new shapes register here.
 */
export class ShapeRegistry {
  private readonly shapes = new Map<string, Shape>();

  constructor(shapes: readonly Shape[] = CORE_SHAPES) {
    for (const s of shapes) this.shapes.set(s.id, s);
  }

  get(id: string): Shape | undefined {
    return this.shapes.get(id);
  }

  has(id: string): boolean {
    return this.shapes.has(id);
  }
}
