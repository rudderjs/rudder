---
'@rudderjs/cli': minor
---

Add `rudder add <package>` — install a RudderJS package end-to-end with one command.

## What it does

```
$ pnpm rudder add queue

  Adding @rudderjs/queue...
  ✓ added 1 dependency
  Generated config/queue.ts
  Registered "queue" in config/index.ts
  Refreshing provider manifest...

  ✓ queue is ready.
    Background jobs: `import { Bus } from "@rudderjs/queue"; Bus.dispatch(new MyJob())`.
```

Each invocation:

1. Validates the alias against a known registry (25 packages — same set the scaffolder offers under "Custom").
2. Checks dependencies (e.g. `passport` requires `auth` + Prisma).
3. Runs the package manager (auto-detected from `npm_config_user_agent`) to install `@rudderjs/<name>`.
4. Writes `config/<name>.ts` from a vendored template — skipped if the file already exists.
5. Surgically inserts the new entry into `config/index.ts` (import line + `configs = { ... }` key). Idempotent: re-running returns "already registered" without duplicating anything.
6. Re-runs `providers:discover` so the framework picks up the new provider.
7. Prints a one-line hint specific to the package (e.g. `Set ANTHROPIC_API_KEY in .env` for `ai`).

## Why

Pairs with the `create-rudder-app` recipe simplification (PR #519). The scaffolder now ships with a minimal default; `rudder add` is the natural growth path for "I want to add queue / mail / telescope later" without manually editing `package.json`, generating a config file, and re-running `providers:discover`.

## Supported aliases

`auth`, `sanctum`, `passport`, `socialite`, `crypt`, `queue`, `storage`, `scheduler`, `mail`, `notifications`, `broadcast`, `sync`, `localization`, `pennant`, `http`, `process`, `concurrency`, `terminal`, `image`, `telescope`, `pulse`, `horizon`, `ai`, `mcp`, `boost`. Accepts either the short alias (`rudder add queue`) or the full npm name (`rudder add @rudderjs/queue`).

## Skip-boot

`add` is in the CLI's skip-boot list — the freshly-added provider hasn't been registered with the manifest yet, so booting the app would crash on the missing provider before the command's own `providers:discover` step gets a chance to refresh the manifest.
