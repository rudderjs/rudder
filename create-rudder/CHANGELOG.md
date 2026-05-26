# create-rudder

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
