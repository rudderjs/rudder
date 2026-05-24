# `vike-react-rsc-rudder`

React Server Components support for [Vike](https://vike.dev). This is a
**RudderJS-maintained fork** of [`vike-react-rsc`](https://github.com/nitedani/vike-react-rsc)
by **nitedani**, **MIT-licensed** (see `LICENSE`). Copyright for the original
work remains with nitedani and contributors; the fork's changes are documented
below.

## Why this fork exists

The working version of the upstream package (`1.0.0`) lives **only** in the
GitHub repository — npm has nothing but a `0.0.0` stub published in 2024-04, and
the upstream "Publish?" request ([issue #3](https://github.com/nitedani/vike-react-rsc/issues/3),
2025-11-13) is unanswered. RudderJS's RSC integration needs an installable,
versioned package, so we publish this maintained fork.

### Why the name isn't `@rudderjs/…`

Vike's config-extension mechanism only recognizes an extension's `extends`
import (and turns it into a pointer import) when the package name **starts with
`vike-`** — see `path.startsWith('vike-') && path.endsWith('/config')` in vike's
`transpileWithEsbuild`. A scoped `@rudderjs/…` name isn't detected, so apps
would have to add a `with { type: 'vike:pointer' }` attribute to the `extends`
import in every `+config.ts`. Keeping the unscoped `vike-*` convention (as
`vike-react`, `vike-vue`, … all do) means RSC apps wire it up with a plain
`extends: [vikeReactRsc]` and no per-app ceremony. The `-rudder` suffix marks
it as our fork and distinguishes it from upstream's `vike-react-rsc`.

It is consumed by `@rudderjs/vite`'s view scanner, which detects either
`vike-react-rsc-rudder` (preferred) or the legacy upstream `vike-react-rsc` name
and generates RSC page stubs that import from whichever is installed.

## Source

- Upstream: https://github.com/nitedani/vike-react-rsc
- Forked at commit: `094054c7649d70707b8f5749ca3e22e33a67801f` (2025-12-06,
  upstream `main` HEAD as of forking)

## Changes from upstream

- `package.json`: renamed to `vike-react-rsc-rudder`; published publicly
  (`publishConfig.access: public`); `@vitejs/plugin-rsc` moved from
  `devDependencies` to `dependencies` (the build externalizes it, so consumers
  need it at runtime); `react` / `react-dom` / `vite` / `vike` dev pins aligned
  to the RudderJS monorepo versions.
- `src/constants.ts` + `src/config.ts`: the package self-references
  (`PKG_NAME`, the vike config `name`, and the `import:…/__internal/…`
  specifiers) updated to the fork package name.
- `src/config.ts`: config import strings name the export (`:default`) — vike
  ≥0.4.257 requires it; the upstream 1.0.0 (built against 0.4.246) omitted it,
  which crashed vike's dev `optimizeDeps`.
- `src/config.ts`: the SSR build's `rollupOptions.input` also includes Vike's
  server entry (`entry: serverEntryVirtualId`). Upstream targets `vike-server`
  (no `+server.ts`); RudderJS uses the `+server.ts` → `app.fetch` model, where
  `@brillout/vite-plugin-server-entry` needs that entry — otherwise the
  production build fails with "Cannot find build server entry".
- `src/plugin/plugins/injectManifestBuild.ts`: the page-entry virtual id was
  renamed by vike (`virtual:vike:pageConfigValuesAll:server:` →
  `virtual:vike:page-entry:server:`, vike ≥0.4.257). Without the rename the
  production RSC manifest is empty and rendering 500s ("Cannot read properties
  of undefined (reading 'getConfig')"). The module shape
  (`configValuesSerialized`) is unchanged.
- Added this file and `LICENSE` (the upstream repo ships no `LICENSE` file
  despite declaring MIT in `package.json`).

Source is otherwise unmodified. Build: `tsdown --clean` (→ `dist/`). The vike
version-compat changes above (config import strings, the page-entry virtual id)
should be re-checked whenever vike is bumped.

## Re-syncing from upstream

Re-copy `src/`, `tsdown.config.ts`, and `tsconfig.json` from a newer upstream
commit, then re-apply the changes above. Update the commit hash in this file.
