# create-rudder

## 1.3.0

### Minor Changes

- 2190d6d: feat(scaffolder): publish `create-rudder` — drop the `-app` suffix from the install command

  The Rudder scaffolder now ships as `create-rudder`. Use `npm create rudder@latest`, `pnpm create rudder`, `yarn create rudder`, or `bunx create-rudder` — aligns with modern peers (Vite, Vue, Astro, Solid, Hono, Remix) and the `RudderJS → Rudder` brand sweep.

  The new `create-rudder` package is a tiny stub that delegates to `create-rudder-app` (still the source of truth); both ship in lockstep via a Changesets `fixed` link. The old `create-rudder-app` install command keeps working — it now prints a one-line nudge pointing at the new form. No prompts, output, or generated files change.

### Patch Changes

- Updated dependencies [2190d6d]
  - create-rudder-app@1.3.0
