---
"@rudderjs/vite": minor
---

feat(vite): detect the `vike-react-rsc-rudder` renderer (and keep upstream name)

The view scanner now recognizes `vike-react-rsc-rudder` (RudderJS's maintained
fork of vike-react-rsc) as the RSC renderer, alongside the legacy upstream
`vike-react-rsc` name. Both map to the same `react-rsc` mode, and having both
installed is treated as the same renderer (no false "multiple renderers" error).

The generated server-component page stub now imports `getPageContext` from
**whichever** RSC package is installed (`vike-react-rsc-rudder/pageContext`
preferred, falling back to `vike-react-rsc/pageContext`), so apps on either name
keep working.

Opt-in / experimental — the default `vike-react` whole-page-hydration model is
unchanged.
