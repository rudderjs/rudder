---
"@rudderjs/vite": minor
"@rudderjs/auth": minor
"@rudderjs/view": minor
---

Adopt three Vike framework-author hooks landed in 2025 for unified DX:

- **`+onCreatePageContext`** — `@rudderjs/vite` now ships a process-wide page-context enhancer registry. Framework packages register a function via `registerPageContextEnhancer(fn)` and it runs on every page render. The first user: `@rudderjs/auth` populates `pageContext.user` automatically — views no longer need a `+data.ts` to read the current user. The augmentation is typed via the `Vike.PageContext` global namespace.

- **`+onError`** — Vike SSR errors are now routed through `@rudderjs/core`'s `report()` so they hit the same reporter/renderer chain as HTTP route errors. `@rudderjs/core` is an optional peer; the hook falls back to `console.error` when it's not installed.

- **`+headersResponse`** — `view('id', props, { headers })` is the new third arg. Pass per-page response headers (`Cache-Control`, CSP, etc.) directly from the controller. The headers can be a plain object or a function (`() => Record<string, string>`) for per-request values like CSP nonces. Framework-owned headers (`set-cookie`, `vary`, anything starting with `x-rudderjs-`) are silently dropped to prevent collisions with server-hono's response pipeline.

### Mechanism

The Vike hooks are wired by the `@rudderjs/vite` views scanner — it writes three one-line re-export stubs to `pages/+onCreatePageContext.ts`, `pages/+onError.ts`, and `pages/+headersResponse.ts` on first sync. These files are user-overwritable: re-running the scanner won't clobber edits. (Vike's `Config.extends` mechanism doesn't support scoped packages, so the scanner generates files that Vike picks up via its native page discovery instead.)

### Migration

- Existing apps: run `pnpm dev` or `pnpm build` once. The scanner emits the three hook stubs to `pages/` automatically. Commit them. No code changes required.
- The `pages/__view/+config.ts` scanner output now also adds `viewHeaders` to `passToClient`, so view components can read response-header context if they need to.
- `pageContext.user` types automatically when both `@rudderjs/auth` and `@rudderjs/vite` are installed.

### Out of scope (deferred follow-ups)

- `@rudderjs/session` flash enhancer (`pageContext.flash`) — adopt the same `registerPageContextEnhancer` pattern.
- `@rudderjs/localization` locale enhancer (`pageContext.locale`) — same shape.
- Typed `+rudderRoute` meta — current `export const route = '/...'` works.
- `+onHookCall` (beta) telescope integration — wait until telescope's request collector is stable.

### No API breaks

- `view(id, props)` (2-arg) still works; the `options` arg is optional.
- `req.user` flow on HTTP routes is unchanged.
- No new required dependencies; `@rudderjs/core` is added as an optional peer of `@rudderjs/vite`, and `@rudderjs/vite` is added as an optional peer of `@rudderjs/auth`.
