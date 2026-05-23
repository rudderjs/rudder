---
"@rudderjs/vite": patch
---

fix(vite): dynamic-prerender codegen no longer fails `tsc` for the array form

The generated `+onBeforePrerenderStart.ts` called the imported `prerender`
symbol directly inside a `typeof source === 'function'` guard. When a view
declared `export const prerender = ['/a', '/b']` (a literal URL array), TS
narrowed the function branch to `never`, so `source()` raised
`TS2349: This expression is not callable`. The hook now normalizes the symbol
to a callable-or-array union before the runtime guard, so all three documented
forms (array, sync function, async function) type-check.
