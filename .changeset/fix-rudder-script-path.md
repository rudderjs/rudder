---
'create-rudder-app': patch
---

Fix: generated `package.json` pointed `pnpm rudder` at `@rudderjs/cli/src/index.ts`, which only exists in the monorepo workspace — published `@rudderjs/cli` ships `dist/` only, so every `pnpm rudder` invocation in a scaffolded project crashed with `ERR_MODULE_NOT_FOUND`. This also broke the post-install `providers:discover` step. Switched to `dist/index.js`.
