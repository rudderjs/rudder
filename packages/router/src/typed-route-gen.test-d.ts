/**
 * Type-only tests for the type-safe `route()` URL generator (Phase 3 of the
 * DX-completion roadmap). The runtime behavior is covered by existing
 * `index.test.ts` and `query-validator.test.ts` cases — this file verifies
 * the TS inference path.
 *
 * Compiled by `pnpm typecheck`; failing assertions surface as tsc errors.
 * Excluded from `node --test` by the `*.test-d.js` glob.
 *
 * The `declare module` block below populates the registry for the duration
 * of the package's typecheck pass. Apps populate it the same way in their
 * own `env.d.ts`.
 *
 * **Soft name strictness**: the name argument is typed `string`, so the
 * framework's own runtime-registered routes (`rb.users.show` in
 * `index.test.ts`) still compile. When the supplied name matches a key in
 * `RouteRegistry`, the params arg narrows to the typed shape — that's the
 * Laravel-parity DX win. Names not in the registry get the loose params
 * record; typos fall through to that path and surface at runtime instead
 * of compile time. See the design note in `index.ts` for why.
 */
import { route } from './index.js'

declare module './index.js' {
  interface RouteRegistry {
    'users.show':         '/users/:id'
    'comments.show':      '/posts/:slug/comments/:cid'
    'files.show':         '/files/:name?'
    'health':             '/health'
  }
}

// ─── Positive cases — required + optional + extras ─────────

route('users.show',    { id: 1 })
route('users.show',    { id: '42' })                            // string OK
route('users.show',    { id: 1, page: 2 })                       // extras → query string
route('users.show',    { id: 1, q: 'hello', sort: 'desc' })      // multiple extras
route('comments.show', { slug: 'hello-world', cid: 7 })          // two required params
route('files.show',    { name: 'avatar.png' })                   // optional name supplied
route('files.show',    {})                                       // optional name omitted — OK
route('health',        {})                                       // no params — empty obj OK
route('health')                                                  // no params — omit entirely

// Names not in the registry compile (framework-internal + dev-loop reality).
// Typos in registered names fall through to this loose path — caught at
// runtime by the `getNamedRoute(name) === undefined` check, not by TS.
route('admin.dashboard')
route('admin.dashboard', { tab: 'overview' })
route('users.shwo', { id: 1 })                                   // typo — runtime-only failure

// ─── Negative cases — declared via @ts-expect-error ────────
//
// These all use REGISTERED names, where TS narrows params strictly.

// @ts-expect-error missing required param `id`
route('users.show', {})

// @ts-expect-error missing required param `cid` on a 2-param path
route('comments.show', { slug: 'x' })

// @ts-expect-error `id` is `string | number`, not `boolean`
route('users.show', { id: true })

// @ts-expect-error `id` is `string | number`, not `null`
route('users.show', { id: null })

// @ts-expect-error param must be number/string, not object
route('users.show', { id: { nested: 1 } })

export {}
