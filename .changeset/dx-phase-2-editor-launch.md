---
"@rudderjs/server-hono": minor
---

feat: editor-launch on dev error-page stack frames

Stack frames in the Ignition-style dev error page are now clickable — clicking any `file:line` jumps your editor to that location via the platform's URL scheme. Picked by the `APP_EDITOR` env var (default `vscode`):

| `APP_EDITOR` | URL scheme |
|---|---|
| `vscode` (default) | `vscode://file/<path>:<line>` |
| `cursor` | `cursor://file/<path>:<line>` |
| `webstorm` / `phpstorm` / `idea` | `<product>://open?file=<path>&line=<line>` |
| `sublime` | `subl://open?url=file://<path>&line=<line>` |
| `atom` | `atom://core/open/file?filename=<path>&line=<line>` |
| `none` | Plain text (no anchor wrapping) |

Unknown values fall back to `vscode` with a single dev-time warning. Windows paths are forward-slashed before being embedded in the URL.

Phase 2 of the DX-completion roadmap (`docs/plans/2026-05-20-dx-completion.md`). Phase 3 (typed `route()` URL generator) and Phase 4 (`make:factory` + `make:seeder`) still pending.
