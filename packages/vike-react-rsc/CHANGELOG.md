# vike-react-rsc-rudder

## 1.0.3

### Patch Changes

- b9bddc5: Require `@brillout/vite-plugin-server-entry@^0.7.19`, which ships the upstream fix for the `isServerEntryOutsideOfCwd` prefix-guard bug. Concurrent monorepo builds of sibling apps whose directory names share a prefix could import the wrong app's server entry and crash prerender with `__VITE_ASSETS_MANIFEST__ is not defined`. We previously carried this as a local patch on 0.7.18; the patch is now dropped in favor of the released version.

## 1.0.2

### Patch Changes

- c566cc8: Bump `@vitejs/plugin-rsc` to `0.5.26` to clear two critical and several high-severity advisories.

## 1.0.1

### Patch Changes

- a7d745a: Exclude the exact client-entry subpath (`${PKG_NAME}/__internal/integration/client`) from the client `optimizeDeps`, not just the package. vike's [#3290](https://github.com/vikejs/vike/issues/3290) fix routes a `client`-config bare specifier into `optimizeDeps.include`; esbuild then fails to pre-bundle this module on its `virtual:client-references` import, breaking RSC dev hydration. `exclude` wins over `include`, so naming the subpath keeps it out. No-op on vike releases without the #3290 fix.
