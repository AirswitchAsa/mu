import { describe, expect, it } from "vitest";
import { relAgo, relWhen } from "./timefmt";

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
