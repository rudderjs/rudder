---
'@rudderjs/passport': patch
---

Stop swallowing provider-boot errors under a misleading "rudder not available" catch.

`PassportProvider.boot()` previously wrapped CLI command registration AND the `make:passport-client` scaffolder block in two nested catch-all `try/catch`es with the comment "rudder not available". `@rudderjs/core` is a hard dep of `@rudderjs/passport`, and `@rudderjs/console` is a hard dep of `@rudderjs/core`, so the dynamic imports always resolve — the catches couldn't possibly fire for the documented reason. What they DID swallow was every legitimate error from `rudder.command(...)` and `registerMakeSpecs(...)`: HMR-induced duplicate-registration bugs, future stub-validation errors, anything thrown inside an `await import('./commands/X.js')` lookup. All silently turned into a no-op boot.

Both wrappers are gone. Errors now surface with their original stack instead of being lost. Closes finding L5 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.
