# create-rudder

## 1.10.2

### Patch Changes

- Updated dependencies [3397d3f]
  - @rudderjs/auth@6.6.1

## 1.10.1

### Patch Changes

- Updated dependencies [866a5dc]
- Updated dependencies [ad9721d]
  - @rudderjs/auth@6.6.0

## 1.10.0

### Minor Changes

- 5470945: Scaffold a committed `.vscode/` directory so a fresh project is F5-debuggable out of the box. `launch.json` ships three Node debug configurations (Debug dev server, Debug rudder command, Debug current test file), `extensions.json` recommends the relevant extensions for the chosen stack (Vite always, plus Tailwind / Prisma / Vue only when selected), and `settings.json` pins the workspace TypeScript and leaves formatting to the user. Cursor reads the same files, so it benefits too. Delete the directory if your editor does not use it.

### Patch Changes

- 1b09488: Add a one-line hint to the post-scaffold panel pointing new projects at `rudder completion install` for shell tab-completion.

## 1.9.2

### Patch Changes

- Updated dependencies [26e134b]
  - @rudderjs/auth@6.5.0

## 1.9.1

### Patch Changes

- 2b07901: Scaffolded apps always get a generated `APP_KEY` in `.env` (and an `APP_KEY=` placeholder with the `key:generate` hint in `.env.example`). It was gated on selecting the crypt package, but sessions sign with `APP_KEY` regardless — so every fresh non-crypt scaffold (including the default web-app recipe) started with a red `rudder doctor` (`✗ APP_KEY unset`) and unsigned session cookies. Laravel parity: `laravel new` generates the key for every app.

## 1.9.0

### Minor Changes

- f0fc21f: `server` is now optional in `Application.configure()` — when omitted, the framework auto-resolves `@rudderjs/server-hono` and constructs it with `config('server')`, so `bootstrap/app.ts` no longer needs the adapter import:

  ```ts
  export default Application.configure({ config: configs, providers })
    .withRouting({ ... })
    .create()
  ```

  Passing `server: hono(configs.server)` explicitly still works and remains the way to use a custom adapter (or to bundle to a single file, where the runtime lookup can't be statically traced). When neither an explicit adapter nor `@rudderjs/server-hono` is available, the first request fails with a clear install-hint error; the CLI path (`boot()`) never needs a server and is unaffected.

  `create-rudder` scaffolds the new adapter-free `bootstrap/app.ts` (the generated app still depends on `@rudderjs/server-hono` — it is resolved at runtime).

## 1.8.0

### Minor Changes

- 7107ed9: Native engine pg/mysql scaffolding (7.9). The Database driver prompt (SQLite / PostgreSQL / MySQL) is now asked for the Native engine too instead of pinning SQLite — the choice wires through to the driver dependency (`postgres` / `mysql2`), `config/database.ts` (native driver names `pg` / `mysql`), `.env` `DATABASE_URL`, and the "Is your DB running now?" confirm (the auto-cascade's `rudder migrate` now honors `--db-ready` on pg/mysql). Non-interactive: `--orm=native --db=postgresql|mysql` works in both the recipe and legacy flag shapes.

  Behavior change: `--db=postgresql|mysql` without `--orm` now stays on the native default engine. Before this release it implied `--orm=prisma` (a back-compat fallback from when native was SQLite-only) — scripts that relied on that must pass `--orm=prisma` explicitly.

- bef393f: Generated type registries consolidate under the committed `.rudder/types/` directory: `views.d.ts` (was `pages/__view/registry.d.ts`), `routes.d.ts` (was `routes/__registry.d.ts`), `models.d.ts` (was `app/Models/__schema/registry.d.ts`). The Vike page stubs stay in `pages/__view/` (pinned by Vike's filesystem routing).

  Migration is automatic — the first dev/build/`routes:sync`/`view:sync`/`migrate` after upgrading writes the new path and deletes the legacy file. One manual step for existing apps: add `".rudder/**/*"` to the `tsconfig.json` `include` array (dot-directories are invisible to `**/*` globs and to bare-directory include entries; new scaffolds ship it). A `.rudder/README.md` is generated alongside, describing each file and its regen command.

- e137a22: Scaffolded apps now include a `.gitattributes` marking the committed generated files (`pages/__view/**`, `routes/__registry.d.ts`, `app/Models/__schema/registry.d.ts`) as `linguist-generated` — GitHub collapses them in PR diffs and excludes them from language stats.

### Patch Changes

- Updated dependencies [aaad9ad]
  - @rudderjs/auth@6.4.1

## 1.7.1

### Patch Changes

- d1130ea: Scaffolded `start`/`preview` scripts now set `NODE_ENV=production`. Running the built server without it mixes React build flavors (the vike SSR bundle bakes production internals while the external `react` package resolves its development build) and every render 500s with `TypeError: dispatcher.getOwner is not a function`.

## 1.7.0

### Minor Changes

- 53d955d: feat(create-rudder): non-interactive recipes default to the native engine (matching the docs and the interactive prompt)

  The flag-driven (CI / AI-agent) flow previously derived `orm: 'prisma'` for every recipe, contradicting the documented native default. Now:

  - `--recipe=...` without `--orm` scaffolds the **native engine** (sqlite), same as the interactive Database prompt's default. `--db` is no longer required in recipe mode — only `--orm=prisma|drizzle` needs a driver choice.
  - An explicit `--db=postgresql|mysql` without `--orm` falls back to **Prisma** — the native engine only scaffolds sqlite today, so the driver you actually asked for wins over the engine default.
  - `--orm=native` combined with `--recipe` no longer demands `--db` (the sqlite pin is honored in validation, not just resolution).
  - The scaffolded `tsconfig.json` gains `"types": ["node", "vite/client"]` so app code touching `import.meta.env` passes `tsc --noEmit` out of the box.
  - `--orm` is now in the documented flag table (native default, prisma/drizzle/none opt-ins).

## 1.6.0

### Minor Changes

- 3ac85bd: feat(create-rudder): add the built-in native engine as a Database option (now the default)

  The scaffolder's **Database** prompt now offers **Native** — the zero-dependency built-in engine (`@rudderjs/orm/native`) — alongside Prisma and Drizzle, and it's the pre-highlighted default. Selecting it:

  - pins the driver to SQLite (the native engine's only supported driver today; the driver prompt is skipped) and adds `@rudderjs/orm` + `better-sqlite3` instead of a `@rudderjs/orm-*` adapter package;
  - writes a `config/database.ts` that opts in with `engine: 'native'` (the auto-discovered `NativeDatabaseProvider` boots from it);
  - when auth is selected, scaffolds a working `database/migrations/0001_01_01_000000_create_users_table.ts` so the app is fully migrated and typed out of the box;
  - runs `rudder migrate` in the post-install cascade (instead of the Prisma/Drizzle-only `db:generate` / `db:push`), creating `dev.db`, applying the migration, and generating the typed schema registry.

  `--orm=native` works in non-interactive/JSON mode too (Prisma stays the implicit recipe default there). Prisma/Drizzle remain the path to Postgres/MySQL.

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

### Patch Changes

- Updated dependencies [7e6dc85]
  - @rudderjs/auth@6.4.0

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
