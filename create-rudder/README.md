# create-rudder

**Spin up a production-ready [Rudder](https://github.com/rudderjs/rudder) app in under 60 seconds** — pick a recipe, the installer handles deps, database, auth views, and git init for you.

```bash
pnpm create rudder my-app
cd my-app && pnpm dev
# → http://localhost:3000 — welcome page + register/login working end-to-end
```

Works with every major package manager — the installer detects which one you used and adapts every generated file, install command, and post-scaffold hint.

```bash
pnpm create rudder [name]
npm create rudder@latest [name]
yarn create rudder [name]
bunx create-rudder [name]
```

Skip `[name]` to be prompted for one. The installer then asks four to six questions, runs `pnpm install`, generates the Prisma client, pushes the schema (for SQLite) or asks first (for Postgres/MySQL), publishes auth views, generates Passport keys (when selected), and initializes git — all in one shot.

---

## Full documentation

Recipe table, prompt-by-prompt walkthrough, generated structure, non-interactive (CI/AI agent) flag list, after-scaffold cascade — all live with the framework guide:

- **Installation guide**: <https://github.com/rudderjs/rudder/blob/main/docs/guide/installation.md>
- **Main framework**: <https://github.com/rudderjs/rudder>
- **Report issues**: <https://github.com/rudderjs/rudder/issues>

---

## About this package

`create-rudder` is the package you reach for when you run `npm create rudder@latest`. It's a thin alias around [`create-rudder-app`](https://www.npmjs.com/package/create-rudder-app), which still exists for backwards compatibility — both spawn the same scaffolder. New docs use the shorter `create-rudder` form to match the brand.

---

## License

MIT © [Suleiman Shahbari](https://github.com/rudderjs/rudder)
