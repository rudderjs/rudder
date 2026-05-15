import type { AppRequest, AppResponse } from '@rudderjs/contracts'

// ─── Path-param extraction via template-literal types ──────
//
// `ExtractParams<'/users/:id/posts/:postId'>` evaluates to
// `{ id: string; postId: string }`. Optional `:name?` segments produce
// optional keys (`{ name?: string }`). Regex constraints (`:id{[0-9]+}`)
// are stripped from the captured name; the value type stays `string`
// because path matching is regex-only — coercion is a separate concern
// handled by `.query(schema)` / future `.params(schema)`.
//
// Edge cases:
// - `'/static'` → `{}` (no params; `req.params` is still an object)
// - `'*'` catch-all → `{}` (Hono wildcard isn't a named param)
// - `'/files/:name?'` → `{ name?: string }`
// - `'/users/:id{[0-9]+}'` → `{ id: string }`

/**
 * Parse a single `:name` (or `:name?`, or `:name{regex}`, or `:name?{regex}`)
 * out of the head of a string. Returns `{ name, optional, rest }` or `never`
 * if no name letter follows the `:`.
 */
type ParseParam<S extends string> =
  S extends `${infer Head}${infer Tail}`
    ? Head extends Letter
      ? AccumName<Tail, Head>
      : never
    : never

type Letter =
  | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j'
  | 'k' | 'l' | 'm' | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't'
  | 'u' | 'v' | 'w' | 'x' | 'y' | 'z'
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J'
  | 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T'
  | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z'
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | '_'

type AccumName<S extends string, Acc extends string> =
  S extends `${infer Head}${infer Tail}`
    ? Head extends Letter
      ? AccumName<Tail, `${Acc}${Head}`>
      : FinishName<S, Acc>
    : FinishName<S, Acc>

type FinishName<S extends string, Name extends string> =
  S extends `?${infer Rest}`
    ? { name: Name; optional: true;  rest: StripBraceBlock<Rest> }
    : { name: Name; optional: false; rest: StripBraceBlock<S> }

/** Skip a `{...}` regex constraint block (single level; mirrors router's parser). */
type StripBraceBlock<S extends string> =
  S extends `{${infer _Body}}${infer Rest}` ? Rest : S

/**
 * Walk the path and accumulate every `:param` into a union of
 * `{ name; optional }` records.
 */
type ScanParams<P extends string, Acc = never> =
  P extends `${infer _Head}:${infer Rest}`
    ? ParseParam<Rest> extends { name: infer N; optional: infer O; rest: infer R }
      ? N extends string
        ? R extends string
          ? ScanParams<R, Acc | { name: N; optional: O }>
          : Acc
        : Acc
      : ScanParams<Rest, Acc>  // bare `:` with no letter — skip
    : Acc

/**
 * Map the param union to an object. Optional params become optional keys.
 *
 * Tricks used here:
 * - `as` re-keys the mapped type so the property name is the captured `name`.
 * - Splitting required vs optional via intersection lets us mark optional
 *   keys with `?:` while keeping required ones as `:`. TS doesn't allow
 *   conditional optionality inside a single mapped type.
 */
type ParamUnion<P extends string> = ScanParams<P>

type RequiredParams<P extends string> = {
  [U in Extract<ParamUnion<P>, { optional: false }> as U['name']]: string
}

type OptionalParams<P extends string> = {
  [U in Extract<ParamUnion<P>, { optional: true }> as U['name']]?: string
}

/**
 * Object shape of `req.params` for a literal route path.
 *
 * @example
 * type T1 = ExtractParams<'/users/:id'>                // { id: string }
 * type T2 = ExtractParams<'/users/:id/posts/:postId'>  // { id: string; postId: string }
 * type T3 = ExtractParams<'/files/:name?'>             // { name?: string }
 * type T4 = ExtractParams<'/health'>                   // {}
 */
export type ExtractParams<P extends string> =
  Prettify<RequiredParams<P> & OptionalParams<P>>

/** Flatten an intersection into a single object literal for nicer hovers. */
type Prettify<T> = { [K in keyof T]: T[K] } & {}

// ─── Typed request + handler ───────────────────────────────

/**
 * `AppRequest` with `params` and `query` overridden to the inferred shapes.
 * All other fields (including module-augmented `user`, `session`, `token`)
 * are inherited via `Omit + extend`.
 */
export interface TypedRequest<
  P extends Record<string, string | undefined> = Record<string, string>,
  Q = Record<string, string>,
> extends Omit<AppRequest, 'params' | 'query'> {
  params: P
  query:  Q
}

/**
 * Handler whose `req.params` is derived from the literal path `P`, and whose
 * `req.query` is `Q` (defaulted to `Record<string, string>`; replaced via
 * `{ query: schema }` opts in the route declaration).
 */
export type TypedHandler<
  P extends string,
  Q = Record<string, string>,
> = (
  req: TypedRequest<ExtractParams<P>, Q>,
  res: AppResponse,
) => unknown | Promise<unknown>
