# Behavior: encode_handle

## Condition

A `&ResourceDescriptor`'s `identity` block must be turned into a `&Handle`
string,
or a `&Handle` must be mapped to/from an on-disk directory under `#Storage`.

## Description

Serialize the identity components in the **fixed order for their structural
kind**, upper-casing `entity`, percent-encoding any component character in the
reserved set (`:`, `/`, ASCII whitespace) and leaving all else (`.`, `-`, …)
literal, then join with `:`. The path mapping replaces each `:` with `/`; the
resulting directory *is* the dataset's storage location. Decoding reverses the
steps. The function is total and deterministic: the same identity always
serializes to the same string, and `decode(encode(x)) == x`.

## Outcome

A canonical `&Handle` string and a 1:1 directory path
(`tiingo:ohlcv:BRK.B:1d` ↔ `tiingo/ohlcv/BRK.B/1d/`). Identical identities
collapse to one handle, so `!data_fetch` of the same identity is an idempotent
merge into the same dataset.

## Notes

- Component order per kind is the contract surface; adding a `#Shape` that needs
  a different tail extends the order table, it does not change existing handles.
- Percent-encoding is applied per-component **before** joining/path-mapping, so a
  literal `:` or `/` in a component cannot inject a false component or path
  boundary.
