---
'@rudderjs/ai': patch
'@rudderjs/broadcast': patch
'@rudderjs/cashier-paddle': patch
'@rudderjs/cli': patch
'@rudderjs/console': patch
'@rudderjs/core': patch
'@rudderjs/horizon': patch
'@rudderjs/http': patch
'@rudderjs/mail': patch
'@rudderjs/mcp': patch
'@rudderjs/orm': patch
'@rudderjs/orm-drizzle': patch
'@rudderjs/orm-prisma': patch
'@rudderjs/passport': patch
'@rudderjs/pennant': patch
'@rudderjs/process': patch
'@rudderjs/pulse': patch
'@rudderjs/queue': patch
'@rudderjs/queue-bullmq': patch
'@rudderjs/router': patch
'@rudderjs/schedule': patch
'@rudderjs/server-hono': patch
'@rudderjs/session': patch
'@rudderjs/socialite': patch
'@rudderjs/storage': patch
'@rudderjs/sync': patch
'@rudderjs/telescope': patch
'@rudderjs/terminal': patch
'@rudderjs/view': patch
---

`stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).
