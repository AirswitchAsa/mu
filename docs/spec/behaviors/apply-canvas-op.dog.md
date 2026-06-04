# Behavior: apply_canvas_op

## Condition

The `@Agent` or the `@User` emits one or more `&CanvasOp`s — the agent through
the `#ToolSurface` canvas verbs, the user through `#WebClient` interactions.

## Description

The `#MuServer` is the single applier. For an ordered list of `&CanvasOp`s it:
**(1) authorizes** each op by class — content ops (`create`, `update`, `delete`,
`focus`, `bind`) from either party; layout ops (`move`, `resize`, `reorder`)
**only from the `@User`** (an agent layout op is rejected); **(2) validates** — `create`/
`update` specs against the target `#Renderer`'s `specSchema` (via the
`#RendererRegistry`), `bind` handles' shapes against the renderer's
`requiresShape`, references against existing windows; **(3) applies**
transactionally to `&SessionState` (all-or-nothing); **(4) records provenance**
for `bind` ops into the `provenanceLog`; **(5) runs `!auto_layout`** for new
unplaced windows.

The canvas verbs and their signatures:

| verb | emitter | effect |
|---|---|---|
| `create(type, spec, handle?)` | agent / user | mint a `&Window`; `!auto_layout` places it |
| `update(windowId, spec)` | agent / user | replace/patch the window's content spec |
| `delete(windowId)` | agent / user | remove the window |
| `focus(windowId)` | agent / user | set the focused window |
| `bind(windowId, handle)` | agent / user | bind a `&Handle`; records provenance |
| `move/resize(windowId, placement)` | **user only** | layout (col/row/spans); rejected from the agent |
| `reorder(windowId, targetId, after)` | **user only** | move a window before/after a target in window order (grid flow); rejected from the agent |

## Outcome

`&SessionState` reflects the validated ops or none of them; invalid/unauthorized
ops are rejected, not partially applied. User edits and agent ops reconcile
through one path, so they never diverge.

## Notes

- This is *the* enforcement point for "the agent authors content, not layout"
  and for "agent output is untrusted" — rejection happens before state changes.
- A `create`/`bind` to an unregistered type or a shape-mismatched handle is
  rejected with a typed error the `@Agent` can act on.
