# Actor: Maintainer

## Description

The person who installs, configures, and extends a µ instance: sets provider
credentials, installs `#Resource` and `#Renderer` plugins, and runs the Docker
image. On a self-hosted box this is the same human as the `@User`, but the role
is separated because its authority is **installation and configuration**, not
runtime operation. The credential boundary belongs to the Maintainer: keys live
in `#Resource` configuration server-side (see `&ResourceManifest`) and never
reach the `@Agent` or the browser.

## Notes

- Today the Maintainer installs *trusted code* — in-process `#Resource` and
  `#Renderer` plugins run with the server's privileges (system-design.md §4).
  Third-party sandboxing is designed-for-later (see `!register_renderer`).
- The Maintainer decides what is **configured / available**: an unconfigured
  resource (e.g. orats with no key) is *listed-but-unavailable* in `!data_list`
  (see `!resource_availability`).
