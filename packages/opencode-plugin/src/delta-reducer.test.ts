import { describe, expect, it } from "vitest";
import { newDeltaState, reduceOpencodeEvent, type TurnDelta } from "./index.js";

// =============================================================================
// Unit tests for reduceOpencodeEvent — the pure fold over opencode's GLOBAL event
// stream that rebuilds per-part cumulative prose for one session.
//
// The event SHAPES below are copied verbatim from a live opencode 1.15.5 capture
// (see the gated live suites for the drift-catcher against real opencode). The
// regression these guard: tokens stream as `message.part.delta` ({ partID, field,
// delta }), NOT as repeated `message.part.updated`. An earlier driver listened only
// to `message.part.updated` — which fires twice per part (empty start, full end) —
// and so delivered each prose block whole instead of token-by-token. These tests
// fail loudly if the driver ever regresses to ignoring the delta stream.
// =============================================================================

const SID = "ses_live";
const MID = "msg_assistant";
const PID = "prt_text";

/** message.updated establishing a messageID→role binding. */
const msgUpdated = (id: string, role: string, sessionID = SID) => ({
  type: "message.updated",
  properties: { info: { id, sessionID, role } },
});

/** one incremental token on the live stream. */
const partDelta = (delta: string, opts: Partial<{ partID: string; field: string; messageID: string; sessionID: string }> = {}) => ({
  type: "message.part.delta",
  properties: {
    sessionID: opts.sessionID ?? SID,
    messageID: opts.messageID ?? MID,
    partID: opts.partID ?? PID,
    field: opts.field ?? "text",
    delta,
  },
});

/** the start/completion frame opencode also emits for a part. */
const partUpdated = (text: string, opts: Partial<{ id: string; type: string; messageID: string; sessionID: string }> = {}) => ({
  type: "message.part.updated",
  properties: {
    part: {
      id: opts.id ?? PID,
      sessionID: opts.sessionID ?? SID,
      messageID: opts.messageID ?? MID,
      type: opts.type ?? "text",
      text,
    },
  },
});

/** Fold a list of raw events; return only the non-null deltas produced. */
function run(events: unknown[], sessionId = SID): TurnDelta[] {
  const state = newDeltaState();
  const out: TurnDelta[] = [];
  for (const ev of events) {
    const d = reduceOpencodeEvent(sessionId, ev, state);
    if (d) out.push(d);
  }
  return out;
}

describe("reduceOpencodeEvent", () => {
  it("rebuilds cumulative text token-by-token from message.part.delta", () => {
    const out = run([
      msgUpdated(MID, "assistant"),
      partUpdated("", {}), // empty start frame — must not emit
      partDelta("Rivers"),
      partDelta(" me"),
      partDelta("ander"),
    ]);
    expect(out).toEqual([
      { partId: PID, kind: "text", text: "Rivers" },
      { partId: PID, kind: "text", text: "Rivers me" },
      { partId: PID, kind: "text", text: "Rivers meander" },
    ]);
  });

  it("ignores the empty start frame but lets a non-streamed part through via part.updated", () => {
    // A part that only ever arrives via part.updated (no deltas) must still surface.
    const out = run([msgUpdated(MID, "assistant"), partUpdated("whole block")]);
    expect(out).toEqual([{ partId: PID, kind: "text", text: "whole block" }]);
  });

  it("reconciles to the authoritative completion frame after deltas, ignoring its empty start", () => {
    const out = run([
      msgUpdated(MID, "assistant"),
      partUpdated(""), // start: empty, deltas not begun → skipped (acc not yet present)
      partDelta("ab"),
      partDelta("c"),
      partUpdated("abc"), // completion: authoritative, matches accumulation
    ]);
    expect(out.at(-1)).toEqual({ partId: PID, kind: "text", text: "abc" });
    // the trailing completion frame must NOT blank the part
    expect(out.map((d) => d.text)).toEqual(["ab", "abc", "abc"]);
  });

  it("never echoes the user's own text part (role gating)", () => {
    // The user message we just sent is also a text part; its message is role 'user'.
    const out = run([
      msgUpdated("msg_user", "user"),
      partDelta("hi from user", { messageID: "msg_user", partID: "prt_user" }),
      partUpdated("hi from user", { messageID: "msg_user", id: "prt_user" }),
    ]);
    expect(out).toEqual([]);
  });

  it("drops deltas until the owning message's role is known", () => {
    // If a delta arrives before message.updated, we can't confirm it's assistant → skip.
    const out = run([
      partDelta("early"),
      msgUpdated(MID, "assistant"),
      partDelta("late"),
    ]);
    // only the post-role token survives; the accumulator started fresh at "late"
    expect(out).toEqual([{ partId: PID, kind: "text", text: "late" }]);
  });

  it("filters by session on the global stream", () => {
    const out = run([
      msgUpdated("msg_other", "assistant", "ses_other"),
      partDelta("x", { sessionID: "ses_other", messageID: "msg_other" }),
    ]);
    expect(out).toEqual([]);
  });

  it("skips empty deltas (and the stray non-text field they can carry)", () => {
    const out = run([
      msgUpdated(MID, "assistant"),
      partDelta("", { field: "reasoning" }), // stray empty reasoning frame on a text part
      partDelta("real"),
    ]);
    expect(out).toEqual([{ partId: PID, kind: "text", text: "real" }]);
  });

  it("keeps reasoning and text on separate cumulative tracks", () => {
    const out = run([
      msgUpdated(MID, "assistant"),
      partDelta("think", { partID: "prt_reason", field: "reasoning" }),
      partDelta("ing", { partID: "prt_reason", field: "reasoning" }),
      partDelta("answer", { partID: "prt_text", field: "text" }),
    ]);
    expect(out).toEqual([
      { partId: "prt_reason", kind: "reasoning", text: "think" },
      { partId: "prt_reason", kind: "reasoning", text: "thinking" },
      { partId: "prt_text", kind: "text", text: "answer" },
    ]);
  });
});
