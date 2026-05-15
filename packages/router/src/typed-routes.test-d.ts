/**
 * Type-only test for `ExtractParams<P>` + typed handler signatures.
 *
 * Compiled by `pnpm typecheck` (and the test build); failing type assertions
 * surface as tsc errors. No runtime tests live here — Node's `--test` glob
 * excludes `*.test-d.js`.
 */
import { z } from 'zod'
import { Router } from './index.js'
import type { ExtractParams } from './typed-routes.js'

const router = new Router()

// ─── ExtractParams<P> shape checks ─────────────────────────

// Helper: enforce that two types are equal in both directions.
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const check = <_T extends true>(): void => undefined

check<Eq<ExtractParams<'/users/:id'>, { id: string }>>()
check<Eq<ExtractParams<'/users/:id/posts/:postId'>, { id: string; postId: string }>>()
check<Eq<ExtractParams<'/files/:name?'>, { name?: string }>>()
check<Eq<ExtractParams<'/users/:id{[0-9]+}'>, { id: string }>>()
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
check<Eq<ExtractParams<'/health'>, {}>>()
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
check<Eq<ExtractParams<'*'>, {}>>()

// ─── Handler typing (positive) ─────────────────────────────

router.get('/users/:id', (req) => {
  const id: string = req.params.id
  return id
})

router.post('/users/:id/posts/:postId', (req) => {
  const id:     string = req.params.id
  const postId: string = req.params.postId
  return { id, postId }
})

router.get('/files/:name?', (req) => {
  const name: string | undefined = req.params.name
  return name
})

router.get('/health', (req) => {
  // No params — `req.params` is `{}`. Reading any key would be an error.
  return req.params
})

// ─── Handler typing (negative) ─────────────────────────────

router.get('/users/:id', (req) => {
  // @ts-expect-error `notReal` is not a declared param
  return req.params.notReal
})

router.get('/users/:id', (req) => {
  // @ts-expect-error optional access pattern on required param — `id` is `string`, not nullable
  const id: undefined = req.params.id
  return id
})

router.get('/files/:name?', (req) => {
  // @ts-expect-error `name` is `string | undefined`, not assignable to `string`
  const name: string = req.params.name
  return name
})

// ─── Opts form: req.query inferred from Zod schema ─────────

router.get(
  '/users/:id',
  { query: z.object({ page: z.coerce.number(), q: z.string() }) },
  (req) => {
    const id:   string = req.params.id
    const page: number = req.query.page
    const q:    string = req.query.q
    return { id, page, q }
  },
)

router.get(
  '/search',
  { query: z.object({ q: z.string() }) },
  (req) => {
    // @ts-expect-error `page` is not in the query schema
    return req.query.page
  },
)

router.get(
  '/search',
  { query: z.object({ q: z.string() }) },
  (req) => {
    // @ts-expect-error `q` is `string`, not `number`
    const q: number = req.query.q
    return q
  },
)

// ─── Other AppRequest fields still accessible ──────────────

router.get('/health', (req) => {
  const method:  string                  = req.method
  const url:     string                  = req.url
  const headers: Record<string, string>  = req.headers
  const query:   Record<string, string>  = req.query
  return { method, url, headers, query }
})

export {}
