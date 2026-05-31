---
"@rudderjs/orm": patch
---

Fix `@rudderjs/orm/native` requiring `@rudderjs/core` in a standalone (non-Rudder) Node app.

The `@rudderjs/orm/native` barrel re-exported `NativeDatabaseProvider`, which `extends ServiceProvider` from `@rudderjs/core` (an optional peer) — so importing the engine eagerly loaded `@rudderjs/core` and crashed (`ERR_MODULE_NOT_FOUND`) in a plain Node project that installed only `@rudderjs/orm` + a driver.

The framework provider now lives on its own subpath, **`@rudderjs/orm/native/provider`** (auto-discovery picks it up via `rudderjs.providerSubpath` — no app change needed). The `./native` engine barrel is now framework-free, so `import { NativeAdapter, BetterSqlite3Driver } from '@rudderjs/orm/native'` works with no `@rudderjs/core` installed.

Apps that wire the provider by hand should import `nativeDatabase` from `@rudderjs/orm/native/provider` instead of `@rudderjs/orm/native`.

A new CI gate (`scripts/orm-standalone-smoke.mjs`) packs the package and installs it outside the workspace to certify standalone use and guard against a framework dependency regressing back into the install.
