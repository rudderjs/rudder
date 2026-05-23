---
"@rudderjs/vite": minor
---

feat(vite): detect the `vike-react-rsc` renderer (React Server Components)

The view scanner now recognizes `vike-react-rsc` as a renderer alongside
`vike-react` / `vike-vue` / `vike-solid`. When it is the installed renderer, the
generated `app/Views/**` page is a React **server component** that reads
pageContext via `getPageContext()` from `vike-react-rsc/pageContext` — the
`usePageContext()` hook throws under the `react-server` condition. The
controller still injects `viewProps`, so `view('id', props)` keeps working.

`vike-react` and `vike-react-rsc` are mutually exclusive (both are React
renderers) — installing both raises the existing multiple-renderers error.

Opt-in / experimental: install `vike-react-rsc` instead of `vike-react`. The
default whole-page-hydration `vike-react` model is unchanged.
