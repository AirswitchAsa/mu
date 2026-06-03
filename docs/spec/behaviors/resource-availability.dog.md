# Behavior: resource_availability

## Condition

A `#Resource`'s availability must be (re)computed — at `!register_resource`, or
when a `@Maintainer` changes configuration.

## Description

Compare the `#Resource`'s present config against its `&ResourceManifest`'s
`configSchema`. If all *required* config (e.g. an API key) is present, the
resource is **`available`**; if required config is missing, it is
**`listed_but_unavailable`** — visible in `!data_list` so the `@Agent` knows the
capability *exists* but cannot currently be fetched (an orats with no key is the
canonical example). Zero-config resources (yfinance) are always `available`.

## Outcome

`!data_list` reports each source's accurate availability; `!data_fetch` against
an unavailable resource fails fast with a typed "not configured" error rather
than a vendor auth error.

## Notes

- Listed-but-unavailable is deliberate: the agent should *know the shape of the
  world* (what could be fetched if configured), not have capabilities silently
  hidden.
- Availability is about *configuration presence*, evaluated server-side; the
  secret values themselves never cross the credential boundary (`@Maintainer`).
