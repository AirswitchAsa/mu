import { describe, expect, it } from "vitest";
import {
  decodeHandle,
  encodeHandle,
  handleToPath,
  pathToHandle,
  type Identity,
} from "./handle.js";

describe("encodeHandle", () => {
  it("serializes the v0 shapes in fixed component order", () => {
    expect(
      encodeHandle({ provider: "tiingo", shape: "ohlcv", entity: "AMZN", tail: ["1d"] }),
    ).toBe("tiingo:ohlcv:AMZN:1d");
    expect(
      encodeHandle({ provider: "tiingo", shape: "news", entity: "AMZN", tail: [] }),
    ).toBe("tiingo:news:AMZN");
    expect(
      encodeHandle({
        provider: "orats",
        shape: "options_chain",
        entity: "AMZN",
        tail: ["2026-06-03"],
      }),
    ).toBe("orats:options_chain:AMZN:2026-06-03");
    expect(
      encodeHandle({
        provider: "tiingo",
        shape: "metric",
        entity: "AMZN",
        tail: ["realized_vol_20d", "1d"],
      }),
    ).toBe("tiingo:metric:AMZN:realized_vol_20d:1d");
  });

  it("upper-cases entity and leaves the dot literal (BRK.B needs no special-casing)", () => {
    expect(
      encodeHandle({ provider: "tiingo", shape: "ohlcv", entity: "brk.b", tail: ["1d"] }),
    ).toBe("tiingo:ohlcv:BRK.B:1d");
  });

  it("rejects empty components (a programming error, not agent input)", () => {
    expect(() =>
      encodeHandle({ provider: "", shape: "ohlcv", entity: "AMZN", tail: [] }),
    ).toThrow(/provider/);
  });
});

describe("handle ↔ path", () => {
  it("maps : to / and back, round-trip stable", () => {
    const h = "tiingo:ohlcv:BRK.B:1d";
    expect(handleToPath(h)).toBe("tiingo/ohlcv/BRK.B/1d");
    expect(pathToHandle(handleToPath(h))).toBe(h);
    expect(pathToHandle("tiingo/ohlcv/BRK.B/1d/")).toBe(h); // trailing slash tolerated
  });
});

describe("percent-encoding round-trip stability", () => {
  it("encodes reserved chars (:, /, %, whitespace) so they cannot inject components", () => {
    const id: Identity = {
      provider: "prov",
      shape: "ohlcv",
      // adversarial entity: contains every reserved char + an escape lookalike
      entity: "a:b/c d%2Fe\tf",
      tail: ["x/y", "p:q"],
    };
    const h = encodeHandle(id);
    // no raw reserved char survives inside a component (3 fixed ':' + tail joins only)
    expect(h.split(":").length).toBe(5); // provider shape entity tail0 tail1 — no false splits
    expect(handleToPath(h).split("/").length).toBe(5); // no false path segments
    // decode recovers the exact (upper-cased) components
    const back = decodeHandle(h);
    expect(back.entity).toBe("A:B/C D%2FE\tF");
    expect(back.tail).toEqual(["x/y", "p:q"]);
  });

  it("decode(encode(x)) === x for already-canonical identities (property)", () => {
    const alphabet = "AB.-_19:/% \tXZ";
    const pick = (seed: number, len: number): string => {
      let s = "";
      let n = seed;
      for (let i = 0; i < len; i++) {
        n = (n * 1103515245 + 12345) & 0x7fffffff;
        s += alphabet[n % alphabet.length];
      }
      return s || "X";
    };
    for (let seed = 1; seed <= 300; seed++) {
      const id: Identity = {
        provider: pick(seed * 7, 3).replace(/[:/% \t]/g, "p") || "p",
        shape: pick(seed * 13, 4).replace(/[:/% \t]/g, "s") || "s",
        entity: pick(seed * 17, 5).toUpperCase(),
        tail: [pick(seed * 19, 3), pick(seed * 23, 2)],
      };
      const h = encodeHandle(id);
      expect(encodeHandle(decodeHandle(h))).toBe(h);
      const back = decodeHandle(h);
      expect(back.provider).toBe(id.provider);
      expect(back.shape).toBe(id.shape);
      expect(back.entity).toBe(id.entity);
      expect(back.tail).toEqual(id.tail);
    }
  });
});
