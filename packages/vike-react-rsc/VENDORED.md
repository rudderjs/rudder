# Vendored: `vike-react-rsc`

This is a **vendored copy** of [`vike-react-rsc`](https://github.com/nitedani/vike-react-rsc)
by **nitedani** — React Server Components support for Vike. It is **MIT-licensed**
(see `LICENSE`); copyright remains with the original author and contributors.

## Why it's vendored

The working version (`1.0.0`) lives only in the upstream GitHub repository — npm
has only a `0.0.0` stub published in 2024. RudderJS's RSC integration
(`docs/plans/2026-05-23-vike-react-rsc-integration.md`, Phase 4) needs an
installable, CI-buildable copy, so the source is vendored here as a **private,
unpublished** workspace package and consumed by `playground-rsc/` via
`workspace:*`.

It is **not** published to npm and is **not** part of the `@rudderjs/*` release
set (`"private": true`). It keeps the original package name `vike-react-rsc` so
the `@rudderjs/vite` view scanner detects it and the generated code's bare
`vike-react-rsc/pageContext` imports resolve unchanged.

## Source

- Upstream: https://github.com/nitedani/vike-react-rsc
- Commit: `094054c7649d70707b8f5749ca3e22e33a67801f` (2025-12-06)
- Path: `packages/vike-react-rsc`

## Local changes

- `package.json`: `"private": true`; `@vitejs/plugin-rsc` moved from
  `devDependencies` to `dependencies` (the build externalizes it, so consumers
  need it at runtime); `react` / `react-dom` / `vite` / `vike` dev pins aligned
  to the RudderJS monorepo versions.
- Added this file and `LICENSE` (the upstream repo ships no `LICENSE` file
  despite declaring MIT in `package.json`).

Source is otherwise unmodified. Build: `tsdown --clean` (→ `dist/`).

## Updating

Re-copy `src/`, `tsdown.config.ts`, and `tsconfig.json` from a newer upstream
commit, then re-apply the `package.json` changes above. Update the commit hash
here.
