# @rudderjs/support

Utility library — environment helpers, debug tools, string transforms, peer resolution.

Key exports: `Env`, `config()`, `dump()`, `dd()`, `pick()`, `omit()`, `tap()`, `resolveOptionalPeer()`.

`resolveOptionalPeer()` has a fallback for ESM-only packages that reads `exports['.']['import']` directly — needed because `createRequire().resolve()` fails on ESM-only deps.

No framework dependencies. Lazy-load `node:fs`/`node:path` inside functions — never at top level.
