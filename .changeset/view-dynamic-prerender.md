---
"@rudderjs/vite": minor
---

View scanner now supports **dynamic prerender** for parameterized routes — enumerate the URLs to materialize at build time straight from the view file:

```tsx
// app/Views/Blog/Post.tsx
export const route     = '/blog/@slug'
export const prerender = ['/blog/hello-world', '/blog/another-post']
// Or async for DB-driven slugs:
// export const prerender = async () => prisma.post.findMany(...).then(...)

export default function Post() { … }
```

`pnpm build` writes one static HTML per enumerated URL. The static `export const prerender = true` form (Phase 1) continues to work unchanged — both modes share the same exported name; the scanner picks the right output based on the RHS shape.

Sync arrays, sync functions, and async functions are all accepted. Vike's full `OnBeforePrerenderStart` return shape passes through — string URLs or `{ url, pageContext }` entries for per-URL props.

Detection is anchored to the start of a logical line, so `export const prerender = […]` appearing inside a string (e.g. a documentation snippet in a /demos card) doesn't false-positive as the actual top-level export.
