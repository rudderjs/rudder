---
"create-rudder-app": patch
---

Add explicit `yjs` dependency when the Yjs collaboration demo is scaffolded.

The demo's view imports `yjs` directly (`import * as Y from 'yjs'`), but only `y-websocket` was being added to the generated `package.json`. `yjs` is a peer of `y-websocket` and pnpm's strict resolution doesn't hoist it, so Vite's dependency scan failed with `Failed to run dependency scan ... yjs ... could not be resolved` on the first `pnpm dev` of a fresh install.
