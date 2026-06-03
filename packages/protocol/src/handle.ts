/**
 * Handle — a dataset's stable *identity*, and the only thing the agent moves in
 * place of data (handle.dog.md). This module owns the **locked encoding**
 * (data-architecture.md §3) and proves it round-trip-stable: the encode/decode
 * pair and the handle↔path mapping are total and deterministic.
 */

/**
 * The serialized identity, e.g. `tiingo:ohlcv:AMZN:1d`. Opaque to the agent —
 * it is a string key, never to be parsed outside the broker/storage.
 */
export type Handle = string;

/**
 * The structured identity that `encodeHandle` serializes. Components are ordered
 * `provider : shape : entity : ...tail`, where `tail` is the kind/shape-specific
 * remainder (`["1d"]`, `["realized_vol_20d","1d"]`, `["2026-06-03"]`, or `[]`).
 */
export interface Identity {
  readonly provider: string;
  readonly shape: string;
  readonly entity: string;
  readonly tail: readonly string[];
}

/**
 * Reserved set that must be percent-encoded so it can never inject a false
 * component (`:`) or path boundary (`/`). `%` is reserved too — the escape
 * character must itself be escaped, or `%2F` in a component would decode to `/`.
 * (The handle spec flags round-trip stability as the binding requirement; this
 * is what guarantees it.) Whitespace is the ASCII set only.
 */
const RESERVED = /[:/%\t\n\v\f\r ]/;

function encodeComponent(component: string): string {
  let out = "";
  for (const ch of component) {
    if (ch.length === 1 && RESERVED.test(ch)) {
      out += "%" + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
    } else {
      out += ch;
    }
  }
  return out;
}

function decodeComponent(encoded: string): string {
  return encoded.replace(/%([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

function assertComponent(value: string, role: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`encodeHandle: ${role} component must be a non-empty string`);
  }
}

/**
 * Serialize identity components in fixed order, upper-casing `entity`,
 * percent-encoding reserved characters per-component **before** joining. Total
 * and deterministic: the same identity always yields the same handle.
 */
export function encodeHandle(identity: Identity): Handle {
  assertComponent(identity.provider, "provider");
  assertComponent(identity.shape, "shape");
  assertComponent(identity.entity, "entity");
  const components = [
    identity.provider,
    identity.shape,
    identity.entity.toUpperCase(),
    ...identity.tail,
  ];
  components.forEach((c, i) => assertComponent(c, `tail[${i - 3}]`));
  return components.map(encodeComponent).join(":");
}

/**
 * Reverse of {@link encodeHandle}. `entity` comes back upper-cased (encoding
 * normalized it), so `encodeHandle(decodeHandle(h)) === h` for any canonical
 * handle, and `decodeHandle(encodeHandle(id))` equals `id` with entity upper-cased.
 */
export function decodeHandle(handle: Handle): Identity {
  const components = handle.split(":").map(decodeComponent);
  const [provider, shape, entity, ...tail] = components;
  if (provider === undefined || shape === undefined || entity === undefined) {
    throw new Error(`decodeHandle: malformed handle (need ≥3 components): ${handle}`);
  }
  return { provider, shape, entity, tail };
}

/**
 * Handle → on-disk directory path: replace each `:` with `/`. Safe because every
 * component is already encoded (no literal `:` or `/` survives).
 */
export function handleToPath(handle: Handle): string {
  return handle.split(":").join("/");
}

/** Directory path → handle: the inverse of {@link handleToPath}. */
export function pathToHandle(path: string): Handle {
  return path.replace(/\/+$/, "").split("/").join(":");
}
