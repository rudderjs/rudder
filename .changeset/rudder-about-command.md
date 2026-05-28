---
'@rudderjs/cli': minor
---

`rudder about` — Laravel-parity snapshot of the app.

```bash
pnpm rudder about           # human-readable
pnpm rudder about --json    # machine-readable (bug reports, LLM context)
```

Output covers:

- **Application** — name from `package.json`, plus `APP_ENV` / `APP_DEBUG` / `APP_URL` from `.env`
- **Runtime** — Node version, OS + arch, detected package manager
- **Rudder** — installed `@rudderjs/core` and `@rudderjs/cli` versions
- **Installed packages** — every `@rudderjs/*` present in `node_modules`, sorted, with versions

Skip-boot (~50ms typical) — no app machinery runs, so the command works even when the app can't boot. `.env` is loaded directly so the snapshot reflects what the app would actually see at runtime.

Use cases:

- **Bug reports** — `pnpm rudder about --json` is the one-line attachment maintainers ask for first
- **LLM context** — the JSON output gives an AI agent helping you debug everything it needs about your project's stack in one read
- **Sanity check** — confirm what's actually installed after a deploy / `pnpm install` / framework upgrade
