# Rudder × Vike DX integration

**Status:** planning, 2026-05-12.
**Effort:** ~1.5–2 days, single PR per the minimum-push preference.
**Scope:** Adopt three framework-author Vike hooks landed in 2025 that we don't currently use. Add typed `Vike.PageContext` augmentations where the data is owned. Stay in the same PR; downstream package adoption (session, localization) can ship as follow-ups.
**Prerequisites:** none — Vike ≥ 0.4.239 already pinned via playgrounds.

## Why

Vike has expanded its framework-author surface area substantially since we built `@rudderjs/view`. Three hooks in particular fit our story cleanly and would remove boilerplate from every adopting app:

| Hook | Available | Today's pain |
|---|---|---|
| `+onCreatePageContext(pageContext)` | 0.4.237 (Jul 2025) | Every view re-fetches the current user / locale / flash via its own `+data.ts`. Boilerplate scales with view count. |
| `+onError(error, pageContext)` | 0.4.241, `pageContext` arg in 0.4.248 (Dec 2025) | Vike SSR errors bypass `@rudderjs/core`'s `Exceptions` pipeline — they go to console.error and re-raise instead of through the same reporter/renderer chain as HTTP errors. |
| `+headersResponse(pageContext)` | 0.4.239 (Sep 2025) | Setting per-view response headers (Cache-Control on marketing pages, per-request CSP nonce) requires URL-matching middleware. No way to declare from the view file itself. |

We also haven't formalized typed `Vike.PageContext` augmentations, so framework-injected properties (`req.user`, locale, etc.) aren't visible to view components without `as any` or a manual augmentation.

## What ships

| Component | Path |
|---|---|
| `+onCreatePageContext.ts` registered by `@rudderjs/vite` | `packages/vite/src/+onCreatePageContext.ts` (new) |
| `registerPageContextEnhancer((pageContext) => void \| Promise<void>)` API on `@rudderjs/vite` | `packages/vite/src/page-context-enhancers.ts` (new) |
| `@rudderjs/auth` registers an enhancer for `pageContext.user` | `packages/auth/src/page-context-enhancer.ts` (new) + subpath export |
| `Vike.PageContext.user?: AuthUser` augmentation owned by `@rudderjs/auth` | `packages/auth/src/types/vike.d.ts` (new) |
| `+onError.ts` registered by `@rudderjs/vite` — routes to `Exceptions.report()` | `packages/vite/src/+onError.ts` (new) |
| `+headersResponse.ts` registered by `@rudderjs/view`, sourced from `view('id', props, { headers })` | `packages/view/src/+headersResponse.ts` (new) + `view()` signature update |
| `playground/` exercises each new path | `playground/` |
| Snapshot tests + integration covering the new hooks | `packages/vite/src/page-context-enhancers.test.ts` (new) |
| Changeset (minor on vite, auth, view) | `.changeset/` |

## Detail — `+onCreatePageContext` + enhancers

`@rudderjs/vite` registers a single Vike `+onCreatePageContext` hook that walks a process-wide enhancer registry:

```ts
// packages/vite/src/page-context-enhancers.ts
export type PageContextEnhancer = (pageContext: PageContext) => void | Promise<void>

const enhancers: PageContextEnhancer[] = []

export function registerPageContextEnhancer(fn: PageContextEnhancer): void {
  enhancers.push(fn)
}

export async function runPageContextEnhancers(pageContext: PageContext): Promise<void> {
  for (const fn of enhancers) {
    await fn(pageContext)
  }
}
```

```ts
// packages/vite/src/+onCreatePageContext.ts
import { runPageContextEnhancers } from './page-context-enhancers.js'

export const onCreatePageContext = async (pageContext: PageContext) => {
  await runPageContextEnhancers(pageContext)
}
```

`@rudderjs/auth` opts in via its provider's `boot()`:

```ts
// packages/auth/src/provider.ts (boot method)
import { registerPageContextEnhancer } from '@rudderjs/vite/page-context-enhancers'

registerPageContextEnhancer(async (pageContext) => {
  pageContext.user = await Auth.user()
})
```

Each adopting package owns its augmentation:

```ts
// packages/auth/src/types/vike.d.ts
declare global {
  namespace Vike {
    interface PageContext {
      user?: AuthUser | null
    }
  }
}
```

Users importing `@rudderjs/auth` automatically get the typed `pageContext.user`. Sessions / localization can follow the same pattern in subsequent PRs — no further changes to `@rudderjs/vite` needed.

## Detail — `+onError`

`@rudderjs/vite` registers a Vike error hook that delegates to `@rudderjs/core`'s `Exceptions.report()`:

```ts
// packages/vite/src/+onError.ts
import type { PageContext } from 'vike/types'

export const onError = async (error: unknown, pageContext: PageContext): Promise<void> => {
  // Lazy-load core to avoid a hard dependency at module load
  const { report } = await import('@rudderjs/core').catch(() => ({ report: null }))
  if (report) {
    report(error, { source: 'vike', url: pageContext.urlOriginal })
  } else {
    console.error('[RudderJS] Vike SSR error:', error)
  }
}
```

Console fallback when `@rudderjs/core` isn't installed keeps `@rudderjs/vite` runnable standalone (it's a peer dep, not a hard dep).

## Detail — `+headersResponse`

`view()` gains an optional third arg for headers:

```ts
// packages/view/src/view.ts
export interface ViewOptions {
  headers?: Record<string, string> | (() => Record<string, string>)
}

export function view(id: string, props?: object, options?: ViewOptions): ViewResponse { /* … */ }
```

The scanner writes a `+headersResponse.ts` next to each generated view that reads the stored headers from `pageContext`:

```ts
// pages/__view/dashboard/+headersResponse.ts (generated)
export const headersResponse = (pageContext) =>
  pageContext.viewResponse?.headers ?? {}
```

Controller usage:

```ts
Route.get('/marketing/pricing', () => {
  return view('marketing.pricing', { plans }, {
    headers: { 'cache-control': 'public, max-age=3600, s-maxage=86400' },
  })
})
```

Per-request dynamic headers via function form:

```ts
return view('admin.dashboard', props, {
  headers: () => ({ 'content-security-policy': `script-src 'self' 'nonce-${nonce}'` }),
})
```

## Detail — typed augmentations + ownership

Each package owns its `Vike.PageContext` augmentation, mirroring the existing `[[contracts-augmentation-ownership]]` rule:

- `@rudderjs/auth` → `pageContext.user?: AuthUser | null`
- `@rudderjs/session` (follow-up PR) → `pageContext.flash?: Record<string, unknown>`
- `@rudderjs/localization` (follow-up PR) → `pageContext.locale?: string`
- `@rudderjs/view` → `pageContext.viewResponse?: { id, props, headers? }` (internal scanner contract)

This keeps users of single-package installs (e.g. an app that uses `@rudderjs/view` without auth) from seeing types for packages they don't have. Same model as how we handle `req.user` augmentation today — moving the convention up to `PageContext`.

## Out of scope (deferred follow-ups)

- **`@rudderjs/session` flash enhancer** + `pageContext.flash` augmentation. Sub-100-line PR after this one lands.
- **`@rudderjs/localization` locale enhancer** + `pageContext.locale` augmentation. Same shape.
- **`+onHookCall` (beta) telescope integration** — would let `@rudderjs/telescope` trace every Vike hook. Only worth doing once telescope's request collector is stable.
- **`+onCreateGlobalContext` for app bootstrap** — would replace `globalThis['__rudderjs_app__']`. Big churn, no concrete pain today; revisit if we hit a multi-tenant / multi-app scenario.
- **Custom `meta` setting `+rudderRoute`** — typed alternative to `export const route = '/...'`. The string export works fine today; formalizing it is polish, not pain relief.

## Risk + migration

- **HMR cost of enhancers** — `runPageContextEnhancers` runs once per request. Each enhancer should be fast (no DB calls beyond what auth would do anyway). Document this in the API doc.
- **Error hook lazy-load timing** — first error after a cold boot will pay the cost of importing `@rudderjs/core`. Acceptable; alternative is a hard dep we don't want.
- **`+headersResponse` precedence** — server-hono's `normalizeResponse` already sets framework headers (Set-Cookie, X-Real-IP, etc.). The view-provided headers MUST NOT clobber those. Add a deny-list (`set-cookie`, `vary`, anything starting with `x-rudderjs-`) and document. Test cases cover the collision path.
- **No breaking change for existing apps** — all three hooks are additive. Apps that don't use the new APIs see no behavior change.

## Testing

- Unit: enhancer registry order + async handling (`packages/vite/src/page-context-enhancers.test.ts`)
- Unit: `+onError` delegates to `report()` when core is present, console.error when absent
- Unit: `view()` with headers option round-trips through the generated `+headersResponse`
- Integration: spin up playground, hit a view, assert `pageContext.user` populated by enhancer (`playground/test/vike-integration.test.ts`)
- Browser smoke: navigate between views, confirm SPA nav preserves `pageContext.user` and applies `cache-control` headers
- Existing scanner tests stay green

## Phase order

1. `@rudderjs/vite`: enhancer registry + `+onCreatePageContext` + `+onError`
2. `@rudderjs/auth`: register enhancer in provider boot + `Vike.PageContext.user` augmentation
3. `@rudderjs/view`: `view()` headers option + generated `+headersResponse`
4. Playground exercises (view that consumes `pageContext.user`, route that sets cache headers)
5. Tests + changeset

All in one PR. Follow-up PRs (session flash, localization locale) carry their own narrow scope.
