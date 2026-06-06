# @rudderjs/support

Utility library — environment helpers, debug tools, string transforms, peer resolution.

Key exports: `Env`, `config()`, `dump()`, `dd()`, `pick()`, `omit()`, `tap()`, `resolveOptionalPeer()`.

`Env` is typed through the `EnvApi` interface: each reader has a typed-first overload over `EnvRegistry` (the empty augmentation target filled by the generated `.rudder/types/env.d.ts`, emitted from `.env.example` by `@rudderjs/vite`'s env scanner) plus the loose `string` overload — which must STAY (packages read keys apps don't declare). Object literals can't carry overload signatures, hence the interface.

`resolveOptionalPeer()` has a fallback for ESM-only packages that reads `exports['.']['import']` directly — needed because `createRequire().resolve()` fails on ESM-only deps.

No framework dependencies. Lazy-load `node:fs`/`node:path` inside functions — never at top level.
