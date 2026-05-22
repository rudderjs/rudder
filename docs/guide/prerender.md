# Prerendering

Opt views into build-time static rendering with a single export. The marker lives in the view file, not the controller — that's where "this is pure" is true.

```tsx
// app/Views/Landing.tsx
export const prerender = true
export const route     = '/'

export default function Landing() {
  return <h1>Welcome</h1>
}
```

`pnpm build` writes `dist/client/index.html` to disk. Production serves the static file before falling back to SSR — zero per-request cost.

Build-time only. `pnpm dev` still SSRs every request; the marker is inert in dev.

## Static prerender

Use `export const prerender = true` for views whose markup doesn't depend on per-request state — marketing pages, docs, terms, 404. The scanner picks the flag up the same way it reads `export const route`.

```tsx
// app/Views/Marketing/Pricing.tsx
export const prerender = true
export const route     = '/pricing'

export default function Pricing() { /* … */ }
```

The build emits one HTML file at the view's URL. Toggling the export off removes the generated artifact on the next scan.

## Dynamic prerender

For parameterized routes (`/blog/@slug`, `/products/@id`), declare the URLs to materialize at build time. The scanner accepts an array literal, a sync function, or an async function — whatever shape fits the data source:

```tsx
// app/Views/Blog/Post.tsx
export const route     = '/blog/@slug'
export const prerender = ['/blog/hello-world', '/blog/another-post']

export default function Post() {
  const ctx  = usePageContext()
  const slug = ctx.routeParams.slug
  // …
}
```

For DB-backed slugs, return the URLs from a function:

```tsx
// app/Views/Docs/Article.tsx
import { Post } from 'App/Models/Post.js'

export const route     = '/docs/@slug'
export const prerender = async (): Promise<string[]> => {
  const posts = await Post.query().select(['slug']).all()
  return posts.map(p => `/docs/${p.slug}`)
}
```

`pnpm build` calls the function once and writes one HTML per returned URL. The full Vike `OnBeforePrerenderStart` return shape passes through — return `{ url, pageContext }` entries when you need per-URL props injected at build time.

The scanner detects the dynamic form from the right-hand side of the assignment — array literal (`[`), arrow / call expression (`(`), or a `function` keyword. Variable-reference RHS (`= MY_LIST`) is intentionally not picked up; opt-in is explicit. Inline the value or wrap in a function.

## How the scanner reads the export

The detection regex is anchored at the start of a logical line — `^export const prerender …` with multiline matching. This means a documentation snippet like `export const prerender = ['/a']` appearing inside a string elsewhere in the file (e.g. a card description) won't false-positive as the actual top-level export.

The generated artifacts under `pages/__view/<id>/` are:

| Mode      | Files emitted                                          |
|-----------|--------------------------------------------------------|
| `off`     | (none)                                                 |
| `static`  | `+prerender.ts` only                                   |
| `dynamic` | `+prerender.ts` AND `+onBeforePrerenderStart.ts`       |

Switching between modes is symmetric — removing the export drops all generated files; flipping dynamic → static drops the hook but keeps the boolean opt-in.

## Constraints

- **Build-time only.** Dev mode is unaffected. `pnpm dev` always SSRs.
- **Controllers don't run per-URL at prerender time.** For dynamic prerender, route params come back on `pageContext.routeParams.slug` (or whatever the segment is named). Either read them via `usePageContext()` in the view, or return `{ url, pageContext: { viewProps: … } }` entries from the function form to inject view props at build time.
- **Auth-guarded views are trivially incompatible.** The user is unknown at build time. Opt-in is per-view, so this is the default — `Dashboard.tsx` is never accidentally prerendered.
- **Variable-reference RHS is not detected.** `export const prerender = MY_LIST` stays `off`. Inline or wrap in a function.

## Related

- [Typed Views](/guide/typed-views) — `export interface Props` in the view file for typed `view('id', props)` calls.
- [Controllers](/guide/controllers) — the routing surface that returns `view('id', props)`.
