# @rudderjs/terminal

## 1.1.3

### Patch Changes

- bdfb88c: Fix `make:terminal` generating a broken component (found by dogfooding).

  `pnpm rudder make:terminal <Name>` wrote `app/Terminal/<Name>Terminal.ts` — a `.ts` file containing JSX (Ink), which doesn't compile, with a spurious `Terminal` suffix that the `terminal('id')` resolver (`'dashboard'` → `app/Terminal/Dashboard.tsx`) could never find. So scaffolded terminal components neither compiled nor resolved.

  - `@rudderjs/console` — `MakeSpec` gains an optional `extension` field (defaults to `ts`); `executeMakeSpec` honors it. Lets a stub opt into `tsx` (or any extension) instead of the hardcoded `.ts`.
  - `@rudderjs/terminal` — `makeTerminalSpec` now sets `extension: 'tsx'` and drops the `Terminal` suffix, so `make:terminal Dashboard` produces `app/Terminal/Dashboard.tsx` — which compiles and is resolvable by `terminal('dashboard')`, matching the documented behavior.

## 1.1.2

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

## 1.1.1

### Patch Changes

- 7eab2d2: Author `boost/guidelines.md` for the 6 packages that previously had no boost content. Adopting apps now get per-package guidelines for these packages too — `@rudderjs/boost` was already capable of consuming them, only the source content was missing.

  Also adds `"boost"` to the `files` array in `package.json` for the 5 packages that didn't include it (`@rudderjs/terminal` already did), so the guidelines actually ship via npm.

  No code changes.

## 1.1.0

### Minor Changes

- 31d0c31: Add `@rudderjs/terminal` — `terminal('id', props)` renders Ink/React components from `app/Terminal/` in rudder commands, mirroring the `view()` ergonomics for the browser. Also adds `make:terminal` scaffolder to `@rudderjs/cli`.
