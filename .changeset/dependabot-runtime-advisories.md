---
"@rudderjs/server-hono": patch
"@rudderjs/mail": patch
---

fix: bump vulnerable dependency ranges flagged by Dependabot

- **`@rudderjs/server-hono`** — raise `@hono/node-server` from `^1.19.10` to
  `^1.19.14`, clearing two advisories on the older line (the previous range
  could still resolve a vulnerable patch).
- **`@rudderjs/mail`** — narrow the optional `nodemailer` range from
  `^7.0.11 || ^8.0.0` to `^8.0.5`. The advisory affects `<= 8.0.4` and there
  is no patched 7.x release, so nodemailer 7 support is dropped — installs now
  require the patched 8.x line.

Transitive advisories (postcss, defu, lodash, effect, diff) are pinned to
patched versions via root `pnpm.overrides`; turbo is bumped in devDependencies.
Those don't affect any published package's surface and so aren't versioned here.
