# Publish `vike-react-rsc-rudder` (maintained fork)

**Date:** 2026-05-24
**Status:** in progress
**Branch:** `feat/scoped-vike-react-rsc`

## Why

RSC support shipped (#639/#640/#641) on top of a **vendored** copy of
nitedani's `vike-react-rsc` — the working `1.0.0` lives only on the upstream
GitHub repo; npm has nothing but a `0.0.0` stub from 2024-04. We kept the
vendor `private: true` and consumed it from `playground-rsc/` via `workspace:*`.

Path checked 2026-05-24:

- Our vendored commit (`094054c`) **is** upstream `main`'s HEAD — no movement
  since 2025-12-06.
- npm still has only `0.0.0` (2024-04-24). Upstream issue **#3 "Publish?"**
  (2025-11-13) is unanswered.
- So "upstream our patches → depend on the npm release" is blocked on the
  maintainer publishing *at all*, not on whether our patches land.

Decision: **own it as a maintained fork** — publish `vike-react-rsc-rudder` so
RudderJS apps can install RSC from npm. MIT; attribution to nitedani preserved.

## Decisions

- **Name: unscoped `vike-react-rsc-rudder`, NOT `@rudderjs/…`.** Vike's
  config-extension mechanism only recognizes an extension's `extends` import
  (and converts it to a pointer import) when the package name **starts with
  `vike-`** — `path.startsWith('vike-') && path.endsWith('/config')` in vike's
  `transpileWithEsbuild`. A scoped `@rudderjs/vike-react-rsc` is not detected,
  forcing a `with { type: 'vike:pointer' }` attribute (+ `@ts-expect-error`) on
  the `extends` import in every app's `+config.ts` (verified working, but a
  fragile per-app wart). Naming it `vike-*` like every other vike extension
  makes it work with a plain `extends: [vikeReactRsc]`. The `-rudder` suffix
  marks it as our fork and distinguishes it from upstream.
- **Gate the publish** — this pass does the rename + PR; the first npm publish
  happens through the normal `version → release` flow after merge.
- **Dual-name detection** — the `@rudderjs/vite` scanner detects both
  `vike-react-rsc-rudder` and the legacy upstream `vike-react-rsc` (friendly to
  anyone on upstream, future-proofs if upstream ever publishes). The generated
  RSC page stub imports from **whichever is installed**.

## Surface

### 1. `packages/vike-react-rsc/` (folder kept; package `name` is the source of truth)
- `package.json`: `name` → `vike-react-rsc-rudder`; drop `private: true`;
  add `publishConfig.access: public`, `repository`/`homepage`/`bugs`, keep MIT.
- `src/constants.ts`: `PKG_NAME` → `vike-react-rsc-rudder` (single source —
  cascades to the plugin's `virtuals`/`register`/`runtime` self-imports).
- `src/config.ts`: vike config `name` + the 6 `import:…/__internal/…`
  specifiers → fork name.
- `VENDORED.md` → `README.md` reframed as a maintained fork notice (keeps
  nitedani MIT attribution + upstream commit provenance + the local-patch list +
  the unscoped-name rationale above).

### 2. `packages/vite/src/views-scanner.ts` (only framework coupling)
- `detectFramework`: map both `vike-react-rsc-rudder` and `vike-react-rsc`
  → `react-rsc`; dedupe so installing both copies of the *same* renderer
  doesn't trip the "multiple renderers" guard.
- New `rscPackageName(cwd)`: returns the installed RSC package name (fork
  preferred), defaulting to the fork name.
- `reactRscStub`: emit `import { getPageContext } from '<resolved>/pageContext'`.
- Update the "install only one of …" error message.
- Tests: assert fork codegen + legacy-name + dual-RSC-no-throw cases (91/91).

### 3. `playground-rsc/`
- `package.json` dep → `vike-react-rsc-rudder`.
- Imports: `pages/+config.ts` (`/config`, plain `extends`), `app/Actions/counter.ts`
  (`/server`), the generated `pages/__view/**/+Page.tsx` (regenerated).

### 4. Release plumbing
- Changeset: `@rudderjs/vite` **minor** (new RSC detection/codegen).
- No changeset needed for `vike-react-rsc-rudder` — its `1.0.0` isn't on npm,
  so `changeset publish` publishes it on the next release.
- `eslint.config.js`: keep the `packages/vike-react-rsc/**` lint exemption
  (still upstream-derived; clean re-syncs from upstream matter); comment updated.

## Verification (done locally)

- `pnpm build` (vike-react-rsc-rudder + vite + playground-rsc) ✓
- `pnpm typecheck` ✓
- `pnpm --filter @rudderjs/vite test` → 91/91 ✓
- `pnpm --filter @rudderjs/vite lint` → 0 errors ✓
- `playground-rsc` PRODUCTION build + server smoke: `GET /` 200, server-rendered
  RSC view + `view()` props + flight payload + client island ✓ (full browser-driven
  action round-trip is the CI `rsc-e2e` gate).

## Caveat (not blocking this PR)

RSC also depends on the dev-only vike patch (`patches/vike@0.4.257.patch`,
optimizeDeps). `pnpm.patchedDependencies` is **not inherited by consumer apps**,
so publishing makes *prod* RSC installable but *dev* in a third-party app still
needs that patch. Real turnkey user-app RSC ⇒ upstream the vike patch (or ship
an equivalent) — tracked separately.

## Out of scope

- Running `pnpm release` (post-merge, explicit go-ahead).
- Upstreaming the vike-compat patches to nitedani / vike (separate, optional).
