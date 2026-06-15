---
"@rudderjs/server-hono": patch
---

Fix the dev error page's `RUDDERJS` version badge. It previously read this adapter's own `package.json` (via `import.meta.url`), so it showed the server-hono adapter's version mislabeled as "RudderJS" and leaked a hard-coded `1.x` placeholder whenever that on-disk read failed (bundled/serverless deploys). It now resolves the app's installed `@rudderjs/core` version through a new `resolveRudderVersion()` helper — a `createRequire` rooted at the cwd (the app root at request time), mirroring `@rudderjs/vite`'s existing resolver — and omits the badge entirely when no version resolves rather than rendering the placeholder.
