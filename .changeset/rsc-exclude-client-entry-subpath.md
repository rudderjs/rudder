---
"vike-react-rsc-rudder": patch
---

Exclude the exact client-entry subpath (`${PKG_NAME}/__internal/integration/client`) from the client `optimizeDeps`, not just the package. vike's [#3290](https://github.com/vikejs/vike/issues/3290) fix routes a `client`-config bare specifier into `optimizeDeps.include`; esbuild then fails to pre-bundle this module on its `virtual:client-references` import, breaking RSC dev hydration. `exclude` wins over `include`, so naming the subpath keeps it out. No-op on vike releases without the #3290 fix.
