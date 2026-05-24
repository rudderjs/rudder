---
"@rudderjs/vite": minor
---

feat(vite): RSC-compatible routes + framework hooks in the view scanner

When `vike-react-rsc` is the renderer, the view scanner now:

- pins each view's route via an inlined `route` value in its `+config.ts`
  instead of a separate `+route.ts` module, and
- wires the RudderJS framework hooks (`onCreatePageContext`, `onError`,
  `headersResponse`) via Vike `import:` strings in the generated view-root
  `+config.ts` rather than physical `pages/+<hook>.ts` re-export stubs.

Both avoid `vike-react-rsc`'s client-bundle exclusion, which strips server-only
`+*.ts` project modules to `export default {}` — that otherwise broke Vike's
client router (route read as an object) and crashed hydration (the global
`onCreatePageContext` hook lost its export). Leaf-dir detection is now
framework-agnostic (any `+Page.*`, not only `+route.ts`).

No change for the `vike-react` / `vike-vue` / `vike-solid` renderers.
