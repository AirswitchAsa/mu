import { describe, expect, it } from "vitest";
import {
  colsForWidth,
  DEFAULT_SIZE_INDEX,
  MAX_SIZE,
  presetForSize,
  SIZE_PRESETS,
  sizeIndexOf,
  stepSize,
} from "./grid";

describe("size ladder", () => {
  it("presetForSize clamps out-of-range indices", () => {
    expect(presetForSize(0)).toEqual({ colSpan: 1, rowSpan: 1 });
    expect(presetForSize(3)).toEqual({ colSpan: 3, rowSpan: 3 });
    expect(presetForSize(-5)).toEqual(SIZE_PRESETS[0]);
    expect(presetForSize(99)).toEqual(SIZE_PRESETS[MAX_SIZE]);
  });

  it("stepSize moves one notch and clamps at the ends", () => {
    expect(stepSize(0, +1)).toBe(1);
    expect(stepSize(2, -1)).toBe(1);
    expect(stepSize(0, -1)).toBe(0);
    expect(stepSize(MAX_SIZE, +1)).toBe(MAX_SIZE);
  });

  it("sizeIndexOf round-trips the canonical presets", () => {
    SIZE_PRESETS.forEach((p, i) => expect(sizeIndexOf(p)).toBe(i));
  });

  it("sizeIndexOf falls back to L (default) for missing spans and picks nearest by area", () => {
    expect(sizeIndexOf(null)).toBe(DEFAULT_SIZE_INDEX);
    expect(sizeIndexOf({})).toBe(DEFAULT_SIZE_INDEX);
    // a legacy 8×4 placement (area 32) is closest to XL (area 9)
    expect(sizeIndexOf({ colSpan: 8, rowSpan: 4 })).toBe(3);
    // a 1×3 placement (area 3) is closest to M (area 2) or L (area 4) — M wins the tie by order
    expect(sizeIndexOf({ colSpan: 1, rowSpan: 3 })).toBe(1);
  });
});

describe("colsForWidth", () => {
  it("derives columns from width, clamped to [2, 4]", () => {
    expect(colsForWidth(300)).toBe(2); // too narrow → floor is 2
    expect(colsForWidth(1300)).toBe(3); // desktop → ~3 at target 400
    expect(colsForWidth(4000)).toBe(4); // very wide → capped at 4
  });

  it("accounts for padding and respects a custom target", () => {
    expect(colsForWidth(900, { target: 280, gap: 16 })).toBe(3);
    expect(colsForWidth(900, { target: 280, gap: 16, pad: 600 })).toBe(2); // padding eats width → floor 2
  });
});
