---
"@rudderjs/vite": minor
---

Scanner gains `export const prerender = true` opt-in for `app/Views/**` files. When set, the scanner emits a `+prerender.ts` next to the generated `+Page.*`, so `pnpm build` writes the pre-rendered HTML to `dist/client/<url>/index.html` and the production server serves it before falling back to SSR.

Build-time only — dev still SSRs every request. Suitable for views with no per-request data: landing pages, docs index, terms / privacy / 404. Detected via the same multiline-tolerant regex pattern used for `export const route`, so it works in Vue SFCs too (tolerant of `: boolean` annotation).

The generated `+prerender.ts` is removed automatically when a source file flips the export off in a subsequent scan — symmetric with `+route.ts` content updates.

Phase 2 (dynamic prerender: `export const prerender = () => [...slugs]` with `onBeforePrerenderStart`) is a follow-up. Auth-guarded views are intentionally incompatible — the flag is per-view opt-in, off by default.
