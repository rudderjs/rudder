---
"@rudderjs/vite": patch
---

fix: auto-generated `+Page.tsx` stub uses `ReactNode` from `react` instead of
the global `JSX.Element`. The global `JSX` namespace was removed in
`@types/react@19`; the previous stub only typechecked when an older copy of
`@types/react` happened to be hoisted into a path TypeScript walks. Fresh
installs against React 19 now typecheck cleanly without that accident.
