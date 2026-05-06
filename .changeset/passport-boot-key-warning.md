---
'@rudderjs/passport': patch
---

`PassportProvider.boot()` now emits a clear startup warning when no RSA
keypair is reachable — neither `PASSPORT_PRIVATE_KEY` / `PASSPORT_PUBLIC_KEY`
env vars nor a keypair on disk under the configured key path. Previously
the missing-keys footgun surfaced only on the first `/oauth/*` request as a
generic ENOENT from deep inside `Passport.keys()`, which made the missing
bootstrap step (`rudder passport:keys`) hard to trace. Also exposes
`Passport.keysAvailable(): Promise<boolean>` for runtime probes.
