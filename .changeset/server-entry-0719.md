---
"vike-react-rsc-rudder": patch
---

Require `@brillout/vite-plugin-server-entry@^0.7.19`, which ships the upstream fix for the `isServerEntryOutsideOfCwd` prefix-guard bug. Concurrent monorepo builds of sibling apps whose directory names share a prefix could import the wrong app's server entry and crash prerender with `__VITE_ASSETS_MANIFEST__ is not defined`. We previously carried this as a local patch on 0.7.18; the patch is now dropped in favor of the released version.
