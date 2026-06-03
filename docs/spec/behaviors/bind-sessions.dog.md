# Behavior: bind_sessions

## Condition

An opencode session is created or deleted — the `#OpencodePlugin`'s `event` hook
sees `event.type === "session.created"` or `"session.deleted"` — or the
`#MuServer` opens a new µ session.

## Description

Maintain the **one µ session ↔ one opencode session** mapping and route every
tool call by it. On `session.created`, associate the opencode session id with a
µ `&SessionState` (creating one in the `#SessionStore` if needed) in a
session-keyed map. On `session.deleted`, drop the mapping and the
`#SessionStore`'s `&SessionState` (`end`) — **no data is touched**, since broker
datasets are shared and persist independently of any session. **Routing:**
because each opencode `tool.execute` context carries `sessionID`, every
`#ToolSurface` verb call looks up its µ session via the map — the tool
*definitions* are stateless; all session state lives in µ. (The `#DataBroker`
itself is not session-scoped — every session sees the same shared store.)

## Outcome

Each agent tool call acts on exactly the right session's canvas; ending an
opencode session cleanly tears down its µ `&SessionState` while leaving the
shared dataset store untouched.

## Notes

- The mapping is the seam that lets one stateless plugin serve many sessions —
  the entire per-session identity is `sessionID` + the map.
- This is the *only* place opencode's session lifecycle crosses into µ; swapping
  the agent backend means reimplementing this binding and nothing in the data
  plane (`&PackageLayout`).
