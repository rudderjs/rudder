---
'@rudderjs/core': patch
---

fix(core): make `maintenance.js` client-eval-safe so it no longer crashes browser bundles

`maintenance.js` ran a module-top-level `path.join('storage','framework','down')`, a non-pure side effect that prevented bundlers from tree-shaking the module out of client graphs. Any client bundle that transitively imported `@rudderjs/core`'s main entry (via `@rudderjs/localization`, app service providers, etc.) eagerly evaluated it and threw `Cannot access "node:path.join" in client code`, killing the SPA before hydration (regression introduced in 1.11). The `path.join` is now joined lazily inside `downPath()`, so the module evaluates harmlessly if it lands in a client graph and is tree-shaken when unused. Server-side maintenance behavior is unchanged.
