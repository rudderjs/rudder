# create-rudder

## 1.5.7

### Patch Changes

- 9d00619: Fix `db:generate`/`db:push`/`dev` failing in scaffolded apps on **pnpm 11**
  (`ERR_PNPM_IGNORED_BUILDS`). pnpm 10+ blocks dependency build scripts by default,
  so the SQLite native binding (`better-sqlite3`), the Prisma engine and `esbuild`
  never built. The generated `pnpm-workspace.yaml` now sets
  `dangerouslyAllowAllBuilds: true` — verified to run build scripts on both pnpm 10
  and 11 (an `onlyBuiltDependencies` allowlist is _not_ honored for a standalone
  app on pnpm 11, and `package.json#pnpm` is ignored there entirely, so the dead
  field was dropped). A scaffolded app's dependencies are all framework-curated,
  and npm/yarn run every postinstall by default anyway.

## 1.5.6

### Patch Changes

- 6b97d55: fix: write the JSON/agent-mode scaffold log to a private temp dir

  In `--json`/agent mode the scaffolder wrote its log to a predictably-named
  `create-rudder-<timestamp>.log` directly in the shared OS temp dir. Because the
  name was guessable, a local attacker could pre-plant a file or symlink at that
  path before the write landed (a TOCTOU / symlink attack — the same class the
  framework hardened in #774). The log now goes inside a private, randomly-named
  directory created with `fs.mkdtemp()` (mode 0700, unguessable suffix), so the
  target can't be anticipated. Resolves CodeQL `js/insecure-temporary-file`.

## 1.5.5

### Patch Changes

- 42619cb: `rudder key:generate` — Laravel-parity command for generating a 32-byte `APP_KEY` and writing it to `.env`.

  ```bash
  pnpm rudder key:generate            # generate + write to .env
  pnpm rudder key:generate --show     # print to stdout, leave .env alone
  pnpm rudder key:generate --force    # overwrite an existing non-empty APP_KEY
  pnpm rudder key:generate --path .env.local   # target a different .env file
  ```

  Idempotent behavior:

  - `.env` doesn't exist → created with `APP_KEY=base64:...`
  - `.env` exists but has no `APP_KEY` line → appended
  - `.env` has an **empty** `APP_KEY=` (the fresh-scaffold shape) → replaced silently
  - `.env` has a **non-empty** `APP_KEY=…` → refused with exit 1, unless `--force` is passed (protects production secrets from accidental overwrite)

  Commented-out lines (`# APP_KEY=...`) and similar-prefixed names (`APP_KEYS=...`) are not touched. Preserves all other lines, comments, and ordering in `.env`.

  Also updates every place in the framework that previously emitted the verbose `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` recipe:

  - **doctor → APP_KEY unset** now says `Run \`pnpm rudder key:generate\` to generate a 32-byte APP_KEY and write it to .env`
  - **doctor → APP_KEY too short** now says `Run \`pnpm rudder key:generate --force\` to replace it with a 32-byte key`
  - **`create-rudder` scaffolder** — `.env.example`'s `# Generate with:` hint now points at `pnpm rudder key:generate` instead of the inline `node -e` recipe.

  The scaffolder still generates `APP_KEY` automatically at scaffold time (it always did) — the change only affects the `.env.example` documentation hint, so users cloning a fresh project know which command to run when they need to rotate or regenerate.

## 1.5.4

### Patch Changes

- Updated dependencies [2c9fe2b]
  - @rudderjs/auth@6.3.0

## 1.5.3

### Patch Changes

- Updated dependencies [ace88f0]
  - @rudderjs/auth@6.2.2

## 1.5.2

### Patch Changes

- 2d2dd52: Two fixes found by dogfooding the playground.

  - `@rudderjs/session` — the `session:secret` doctor check returned a green "unset (sessions will sign with APP*KEY)" even when `APP_KEY` was \_also* unset, contradicting the `APP_KEY` error the env category raises and giving false reassurance (there's no signing secret at all). It now warns when both are unset.
  - `create-rudder` — scaffolded apps with a frontend renderer rendered pages with **no `<title>`**. New projects now ship a `pages/+title.ts` that defaults the document title to the app name and lets a controller override it per page via the view props (`view('dashboard', { title: 'Dashboard' })`). The no-frontend recipe's hand-rolled `+onRenderHtml` now uses the app name too, instead of a hardcoded `RudderJS`. (Defined in `+title.ts` rather than inline in `+config.ts` because vike rejects a function `title` there — "runtime in config".)

## 1.5.1

### Patch Changes

- Updated dependencies [6c90ca9]
- Updated dependencies [649b819]
  - @rudderjs/auth@6.2.1

## 1.5.0

### Minor Changes

- e3b7963: Scaffold new apps on Vite 8. Bumps the generated `vite` to `^8.0.0`, `@vitejs/plugin-react` to `^6.0.0` (Vite-8-only), `@vitejs/plugin-vue` to `^6.0.0`, and `@tailwindcss/vite` to `^4.3.0` (which declares Vite 8 support). The Solid path's `vite-plugin-solid` (pulled via `vike-solid`) resolves to 2.11.12+, which adds Vite 8 to its peer range. Validated end-to-end via the scaffolder smoke (React/Vue/Solid: install → build → boot → headless render) and the RSC production e2e under Vite 8 + rolldown.

## 1.4.1

### Patch Changes

- create-rudder-app@1.4.1

## 1.4.0

### Minor Changes

- e0f7e89: feat(scaffolder): colored ANSI wordmark in the installer banner

  Prints a `RUDDER` wordmark in ANSI Shadow block characters as the first thing the scaffolder shows, with a 6-stop gradient centered on `#f3b02f` (the brand orange) — light amber at the top, deep amber at the bottom. Lands the brand on the most-clicked surface in the framework and matches the install-experience identity Laravel/Astro/etc. set for modern scaffolders.

  Skipped automatically when stdout isn't a TTY (CI piping, JSON agent mode), and degrades to plain-text monochrome when `NO_COLOR` is set in the environment.

### Patch Changes

- Updated dependencies [e0f7e89]
  - create-rudder-app@1.4.0

## 1.3.0

### Minor Changes

- 2190d6d: feat(scaffolder): publish `create-rudder` — drop the `-app` suffix from the install command

  The Rudder scaffolder now ships as `create-rudder`. Use `npm create rudder@latest`, `pnpm create rudder`, `yarn create rudder`, or `bunx create-rudder` — aligns with modern peers (Vite, Vue, Astro, Solid, Hono, Remix) and the `RudderJS → Rudder` brand sweep.

  The new `create-rudder` package is a tiny stub that delegates to `create-rudder-app` (still the source of truth); both ship in lockstep via a Changesets `fixed` link. The old `create-rudder-app` install command keeps working — it now prints a one-line nudge pointing at the new form. No prompts, output, or generated files change.

### Patch Changes

- Updated dependencies [2190d6d]
  - create-rudder-app@1.3.0
