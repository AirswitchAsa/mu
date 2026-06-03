import type { CanvasState, Placement, Window } from "@mu/protocol";

// =============================================================================
// µ — playground-manifest reconciliation (pure, headless-testable)
// The canvas is server-authoritative: each change ships the FULL manifest. The
// client keeps the last one and diffs the new one against it, so it patches only
// what changed and never re-resolves an unchanged binding. This is that diff.
// =============================================================================

export interface WindowUpdate {
  readonly id: string;
  readonly window: Window;
  /** the renderer spec changed → re-render content, no refetch. */
  readonly specChanged: boolean;
  /** the bound handle(s) changed → the only case that needs a (re)resolve. */
  readonly bindingsChanged: boolean;
}

export interface ManifestDiff {
  readonly added: Window[];
  readonly removed: string[];
  readonly updated: WindowUpdate[];
  /** window ids whose grid placement changed (layout is user-owned). */
  readonly layoutChanged: string[];
  readonly focusChanged: boolean;
}

/** Stable deep-equality for plain JSON (specs) — key order independent. */
export function stableEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function sameBindings(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function samePlacement(a: Placement | undefined, b: Placement | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.col === b.col && a.row === b.row && a.colSpan === b.colSpan && a.rowSpan === b.rowSpan && a.pinned === b.pinned;
}

/**
 * Diff the previous manifest against the next (server-authoritative) one. `prev`
 * null means a fresh load — everything is `added`. The caller resolves data only
 * for `added` windows and `updated` windows whose `bindingsChanged` is true.
 */
export function reconcile(prev: CanvasState | null, next: CanvasState): ManifestDiff {
  const prevWins = new Map((prev?.windows ?? []).map((w) => [w.id, w]));
  const nextWins = new Map(next.windows.map((w) => [w.id, w]));

  const added: Window[] = [];
  const updated: WindowUpdate[] = [];
  const removed: string[] = [];

  for (const w of next.windows) {
    const before = prevWins.get(w.id);
    if (!before) {
      added.push(w);
      continue;
    }
    const specChanged = !stableEqual(before.spec, w.spec) || before.type !== w.type || before.title !== w.title;
    const bindingsChanged = !sameBindings(before.bindings, w.bindings);
    if (specChanged || bindingsChanged) updated.push({ id: w.id, window: w, specChanged, bindingsChanged });
  }
  for (const id of prevWins.keys()) if (!nextWins.has(id)) removed.push(id);

  const layoutChanged: string[] = [];
  for (const id of nextWins.keys()) {
    if (!samePlacement(prev?.layout?.[id], next.layout?.[id])) layoutChanged.push(id);
  }

  return {
    added,
    removed,
    updated,
    layoutChanged,
    focusChanged: (prev?.focusedWindowId ?? undefined) !== (next.focusedWindowId ?? undefined),
  };
}

/**
 * The set of handles a diff requires (re)resolving: bindings of added windows and
 * of updates whose bindings changed. Everything else is already cached client-side.
 */
export function handlesToResolve(diff: ManifestDiff): string[] {
  const out = new Set<string>();
  for (const w of diff.added) for (const h of w.bindings) out.add(h);
  for (const u of diff.updated) if (u.bindingsChanged) for (const h of u.window.bindings) out.add(h);
  return [...out];
}
