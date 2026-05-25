# `vike-react-rsc-rudder`

React Server Components support for [Vike](https://vike.dev). This is a
**RudderJS-maintained fork** of [`vike-react-rsc`](https://github.com/nitedani/vike-react-rsc)
by **nitedani**, **MIT-licensed** (see `LICENSE`). Copyright for the original
work remains with nitedani and contributors; the fork's changes are documented
below.

## Why this fork exists

The working version of the upstream package (`1.0.0`) lives **only** in the
GitHub repository — npm has nothing but a `0.0.0` stub published in 2024-04.
RudderJS's RSC integration needs an installable, versioned package, so we
publish this maintained fork.

> **This fork is temporary.** In the upstream "Publish?" thread
> ([issue #3](https://github.com/nitedani/vike-react-rsc/issues/3)), nitedani
> plans to rebuild `vike-react-rsc` as a thin layer over the official
> [`@vitejs/plugin-rsc`](https://www.npmjs.com/package/@vitejs/plugin-rsc),
> dropping the custom code this fork patches. When that lands and is published,
> we deprecate this fork and adopt the official package. Treat it as
> **experimental** in the meantime — `vike-react` remains RudderJS's default
> renderer.

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

## Supported versions

RSC is fragile to `vike` / `@vitejs/plugin-rsc` / `vite` bumps and to an
upstream re-sync. These are the versions the integration is **verified green**
against (via the required `RSC E2E` check in CI — `playground-rsc` built for
production, driven through SSR render + a `"use server"` action round-trip):

| Dependency | Verified | Pinned where | Why it's load-bearing |
|---|---|---|---|
| `vike` | `0.4.257` | root `pnpm.overrides` (exact) + `patches/vike@0.4.257.patch` | the `+server.ts` `server` config + the dev `optimizeDeps` patch both target this exact version |
| `@vitejs/plugin-rsc` | `0.5.1` | this package's `dependencies` + `playground-rsc` (exact) | must resolve to a **single instance** — a forked realpath inlines its CJS vendor and crashes SSR (`module is not defined`) |
| `vite` | `7.3.1` | `^7.3.0` (floats) — gated by `RSC E2E`, not frozen | minor bumps can shift the SSR module-runner / optimizer behavior RSC depends on |
| `rolldown` | `1.0.0-beta.8` | root `pnpm.overrides` `tsdown>rolldown` (exact) | newer rolldown breaks `tsdown`'s build of this package |
| `@types/node` | `20.19.35` | root `pnpm.overrides` (exact) | a 20-vs-24 split forks `vite` → `vike` → `@vitejs/plugin-rsc` into two instances |
| `react` / `react-dom` | `19.2.4` | `^19.2.0` | RSC requires React ≥ 19.2 |
| `react-streaming` | `0.4.17` | `^0.4.12` | RSC payload streaming |

**Bump policy:** change one axis at a time and only land it behind a **green
`RSC E2E`** (a required status check on `main`). `vite` is intentionally *not*
frozen monorepo-wide — the gate catches an RSC-breaking bump rather than
freezing every package's `vite`. Because this fork is temporary (see above),
this matrix is an interim safeguard, not a long-term commitment.

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
- `src/config.ts`: the client `optimizeDeps.exclude` names the exact client-entry
  subpath (`${PKG_NAME}/__internal/integration/client`), not just the package.
  vike's [#3290](https://github.com/vikejs/vike/issues/3290) fix routes a
  `client`-config bare specifier into `optimizeDeps.include`; esbuild then tries
  to pre-bundle this module and fails on its `virtual:client-references` import,
  killing dev hydration. `exclude` wins over `include`, so naming the subpath
  keeps it out. No-op on vike without the #3290 fix (Rom confirmed no Vike change
  needed in the issue thread).
- Added this file and `LICENSE` (the upstream repo ships no `LICENSE` file
  despite declaring MIT in `package.json`).

Source is otherwise unmodified. Build: `tsdown --clean` (→ `dist/`). The vike
version-compat changes above (config import strings, the page-entry virtual id)
should be re-checked whenever vike is bumped.

## Re-syncing from upstream

Re-copy `src/`, `tsdown.config.ts`, and `tsconfig.json` from a newer upstream
commit, then re-apply the changes above. Update the commit hash in this file.
