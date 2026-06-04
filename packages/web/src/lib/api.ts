import type { CanvasOp, CanvasState, ChatMessage, RendererManifest } from "@mu/protocol";
import type { DataRow, MuStreamEvent } from "./types";

// =============================================================================
// µ — backend client. The contract is docs/backend-api.md (REST + SSE, CORS-open).
// The SSE decoder is split out as a pure function so it's unit-testable without
// a network or a browser.
// =============================================================================

const BASE: string =
  (import.meta.env?.VITE_MU_API as string | undefined)?.replace(/\/$/, "") ?? "http://127.0.0.1:4000";

async function jsonOf<T>(resp: Response): Promise<T> {
  const body = (await resp.json()) as T & { error?: { code: string; message: string } };
  if (body && typeof body === "object" && "error" in body && body.error) {
    throw new Error(`${body.error.code}: ${body.error.message}`);
  }
  return body as T;
}

export async function createSession(): Promise<string> {
  const r = await fetch(`${BASE}/api/sessions`, { method: "POST" });
  return (await jsonOf<{ sessionId: string }>(r)).sessionId;
}

export async function deleteSession(id: string): Promise<void> {
  await fetch(`${BASE}/api/sessions/${id}`, { method: "DELETE" });
}

export async function getCanvas(id: string): Promise<CanvasState> {
  return jsonOf<CanvasState>(await fetch(`${BASE}/api/sessions/${id}/canvas`));
}

/** Stored chat history for a session (reload-restore; in-memory server-side). */
export async function getMessages(id: string): Promise<ChatMessage[]> {
  return (await jsonOf<{ messages: ChatMessage[] }>(await fetch(`${BASE}/api/sessions/${id}/messages`))).messages;
}

/** opencode's auto-generated session title (undefined if unset / no driver). */
export async function sessionTitle(id: string): Promise<string | undefined> {
  try {
    const r = await fetch(`${BASE}/api/sessions/${id}/title`);
    if (!r.ok) return undefined;
    const { title } = (await r.json()) as { title?: string | null };
    return title ?? undefined;
  } catch {
    return undefined;
  }
}

export async function listRenderers(): Promise<RendererManifest[]> {
  return (await jsonOf<{ renderers: RendererManifest[] }>(await fetch(`${BASE}/api/renderers`))).renderers;
}

/** Full data for a renderer (server-side, unguarded). Rows are shape-specific. */
export async function resolveHandle(handle: string): Promise<DataRow[]> {
  const r = await fetch(`${BASE}/api/resolve?handle=${encodeURIComponent(handle)}`);
  return (await jsonOf<{ handle: string; rows: DataRow[] }>(r)).rows;
}

/**
 * Manually re-acquire bound handles from their sources (the global refresh). With
 * no `handles`, the server refreshes every data-backed handle in the session.
 * Returns which handles were refreshed so the client re-resolves exactly those.
 */
export async function refreshSession(
  id: string,
  handles?: string[],
): Promise<{ refreshed: string[]; errors: { handle: string; code?: string; message: string }[] }> {
  const r = await fetch(`${BASE}/api/sessions/${id}/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(handles ? { handles } : {}),
  });
  return jsonOf<{ refreshed: string[]; errors: { handle: string; code?: string; message: string }[] }>(r);
}

/** User layout/content edits (move/resize/...). The server stays authoritative. */
export async function postUserOps(id: string, ops: CanvasOp[]): Promise<void> {
  await fetch(`${BASE}/api/sessions/${id}/canvas/ops`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ops }),
  });
}

/**
 * Send a message and stream the turn. Calls `onEvent` for each SSE event
 * (canvas/tool/chat/done/error) as it arrives, and resolves when the turn ends.
 */
export async function streamMessage(
  id: string,
  text: string,
  onEvent: (e: MuStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(`${BASE}/api/sessions/${id}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!resp.body) throw new Error("message stream has no body");
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const { events, rest } = decodeSSE(buf);
    buf = rest;
    for (const e of events) {
      onEvent(e as MuStreamEvent);
      if (e && typeof e === "object" && ((e as { type?: string }).type === "done" || (e as { type?: string }).type === "error")) {
        return;
      }
    }
  }
}

/**
 * Pure SSE decoder: pull every COMPLETE `data:` event out of a buffer, returning
 * the parsed events plus the unconsumed remainder. Events are framed by a blank
 * line (`\n\n`); the trailing partial frame stays in `rest`.
 */
export function decodeSSE(buffer: string): { events: unknown[]; rest: string } {
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  const events: unknown[] = [];
  for (const frame of frames) {
    for (const line of frame.split("\n")) {
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trimStart();
        if (payload) {
          try {
            events.push(JSON.parse(payload));
          } catch {
            /* skip a malformed frame rather than break the stream */
          }
        }
      }
    }
  }
  return { events, rest };
}
