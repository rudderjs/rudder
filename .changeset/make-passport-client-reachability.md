---
'@rudderjs/passport': patch
'@rudderjs/cli': patch
---

`make:passport-client` was silently unreachable. The spec was registered inside `PassportProvider.boot()`, but the CLI deliberately skips `bootApp()` for `make:*` argv (the no-boot fast path) — so the spec was never wired into Commander, and `pnpm rudder make:passport-client <Name>` printed the top-level help (Commander treated it as an unknown command) instead of scaffolding the seeder. No error, no file, exit 0.

Moved the spec to the documented CLI-loader subpath pattern used by every other package-contributed `make:*`: `@rudderjs/passport/commands/make-passport-client` exports `makePassportClientSpec` (same shape as `@rudderjs/terminal`'s `make-terminal`), and `@rudderjs/cli`'s `loadPackageCommands()` imports it eagerly. The in-boot registration block in `PassportProvider.boot()` is gone. End-to-end: `pnpm rudder make:passport-client <Name>` now creates `app/Seeders/<Name>.ts` as documented. Found by the Phase 1 scaffolder audit.
