import { describe, expect, it } from "vitest";
import { agoLabel, relAgo, relWhen, whenLabel } from "./timefmt";

describe("relAgo", () => {
  it("formats minutes / hours / days", () => {
    expect(relAgo(6)).toBe("6m");
    expect(relAgo(59)).toBe("59m");
    expect(relAgo(90)).toBe("2h"); // rounds
    expect(relAgo(60 * 24 * 2)).toBe("2d");
    expect(relAgo(-5)).toBe("0m"); // never negative
  });
});

describe("relWhen", () => {
  it("formats past, future, and now", () => {
    expect(relWhen(0)).toBe("now");
    expect(relWhen(-2)).toBe("2h ago");
    expect(relWhen(-48)).toBe("2d ago");
    expect(relWhen(5)).toBe("in 5h");
    expect(relWhen(27)).toBe("in 1d");
  });
});

const HR = 3_600_000;
describe("timestamp variants (vs now)", () => {
  it("agoLabel formats age of a past timestamp", () => {
    const now = Date.UTC(2026, 5, 1, 12);
    expect(agoLabel(now - 3 * HR, now)).toBe("3h");
    expect(agoLabel(now - 30 * 60_000, now)).toBe("30m");
    expect(agoLabel(now + HR, now)).toBe("0m"); // future clamps to 0
  });

  it("whenLabel formats relative future/past timestamps", () => {
    const now = Date.UTC(2026, 5, 1, 12);
    expect(whenLabel(now + 2 * 24 * HR, now)).toBe("in 2d");
    expect(whenLabel(now - 3 * HR, now)).toBe("3h ago");
  });
});
