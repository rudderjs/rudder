# create-rudder

**Spin up a production-ready [Rudder](https://github.com/rudderjs/rudder) app in under 60 seconds** — pick a recipe, the installer handles deps, database, auth views, and git init for you.

```bash
pnpm create rudder my-app
cd my-app && pnpm dev
# → http://localhost:3000 — welcome page + register/login working end-to-end
```

The installer asks four to six questions, then runs `pnpm install`, generates the Prisma client, pushes the schema (for SQLite) or asks first (for Postgres/MySQL), publishes auth views, generates Passport keys (when selected), and initializes git — all in one shot.

---

## Install

All four major package managers work. The installer detects which one you used and adapts every generated file, install command, and post-scaffold hint.

```bash
pnpm create rudder [name]
npm create rudder@latest [name]
yarn create rudder [name]
bunx create-rudder [name]
```

Skip `[name]` to be prompted for one.

> The legacy `create-rudder-app` invocation (`pnpm create rudder-app …`) still works — it now prints a one-line nudge to switch to `create-rudder` and otherwise scaffolds identically.

---

## Full documentation

The detailed scaffolder docs — recipe table, prompt-by-prompt walkthrough, generated structure, non-interactive (CI/AI agent) flag list, after-scaffold cascade — live with the framework guide:

- **Installation guide**: <https://github.com/rudderjs/rudder/blob/main/docs/guide/installation.md>
- **Main framework**: <https://github.com/rudderjs/rudder>
- **Report issues**: <https://github.com/rudderjs/rudder/issues>

---

## Contributing to the scaffolder

The scaffolder source lives at `create-rudder/` in the framework monorepo (the `create-rudder-app` package is a thin stub that re-spawns this one):

```bash
git clone https://github.com/rudderjs/rudder.git
cd rudder/create-rudder
pnpm install
pnpm build
node dist/index.js                              # launches the interactive CLI from source
pnpm test                                       # template tests + snapshot baseline
pnpm smoke                                      # default end-to-end smoke
```

---

## License

MIT © [Suleiman Shahbari](https://github.com/rudderjs/rudder)
