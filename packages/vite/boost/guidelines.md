# @rudderjs/vite

## Overview

Vite plugin that wires RudderJS into the build. Single call produces 5 plugins: Vike registration, view scanner (for `@rudderjs/view`), HMR route reload (`rudderjs:routes`), WebSocket upgrade handler (for `@rudderjs/broadcast` + `@rudderjs/live`), SSR externals, `@/` + `App/` path aliases, and dev-mode `x-real-ip` injection. Required in every RudderJS app's `vite.config.ts`.

## Key Patterns

### Setup

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import rudderjs from '@rudderjs/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [rudderjs(), tailwindcss(), react()],
})
```

Place `rudderjs()` **first** so Vike initialises before UI-framework plugins. `rudderjs()` returns a `Promise<Plugin[]>` — Vite handles it natively, no `await` or spread needed.

### UI framework plugins

Add one UI framework plugin alongside `rudderjs()`:

```ts
// React — @vitejs/plugin-react
// Vue   — @vitejs/plugin-vue
// Solid — vike-solid/vite

plugins: [rudderjs(), react()]
```

Install exactly one of `vike-react` / `vike-vue` / `vike-solid` — the view scanner probes `node_modules/vike-*/package.json` at plugin construction time to pick the matching stub.

### What it produces

| Plugin | Role |
|---|---|
| `rudderjs:config` | SSR externals, path aliases, warning suppression |
| `rudderjs:ws` | WebSocket upgrade handler for broadcast + live |
| `rudderjs:ip` | Dev-only `x-real-ip` injection from the Node socket |
| `rudderjs:routes` | HMR watcher for `routes/`, `bootstrap/`, `app/` — invalidates SSR modules + clears `__rudderjs_instance__` / `__rudderjs_app__` globals |
| `rudderjs:views` | Scans `app/Views/**`, generates Vike pages under `pages/__view/` |

### SSR externals

The following packages are automatically excluded from the SSR bundle (Node-only, must not reach the browser):

- RudderJS queue adapters: `@rudderjs/queue-inngest`, `@rudderjs/queue-bullmq`
- ORM adapters: `@rudderjs/orm-drizzle`
- DB drivers: `pg`, `mysql2`, `better-sqlite3`, `@prisma/adapter-*`, `@libsql/client`
- Redis: `ioredis`
- CLI prompts: `@clack/core`, `@clack/prompts`

`@rudderjs/server-hono` is kept **non-external** (`ssr.noExternal`) so Vite processes its virtual module imports.

### HMR behavior

- Edits under `routes/`, `bootstrap/`, or `app/` invalidate the SSR module graph. Next request re-bootstraps cleanly.
- **Never uses `server.restart()`** — that would close Vite's module runner and break in-flight SSR requests.
- App/ files are captured in closures during provider boot, so the plugin clears `__rudderjs_instance__` and `__rudderjs_app__` globals on change. Module invalidation alone isn't enough for app/.

## Common Pitfalls

- **Not using `@rudderjs/vite`.** Skipping the plugin in favor of a custom config breaks WebSockets in dev (no upgrade handler), breaks view scanning (no generated Vike stubs), breaks HMR (no route reload), breaks IP resolution (no dev `x-real-ip` injection), and lets server-only packages leak into the client bundle. Don't try to replicate manually.
- **Multiple `vike-*` renderers installed.** The scanner throws "Multiple renderers installed" at boot. Install exactly one.
- **`rudderjs()` placed after framework plugins.** Works for builds but causes subtle ordering issues with Vike's config merging. Place it first.
- **Mixed frameworks via include/exclude.** Supported — each plugin scopes to its own pages via Vite's `include`/`exclude` regex. Keep the scopes non-overlapping.
- **Top-level `node:*` imports.** Packages that import `node:fs`, `node:path`, etc. at the top of a file get externalized by Vite and crash in the browser. Always lazy-load inside functions: `const { readFile } = await import('node:fs/promises')`.
- **Custom port 24678.** `@vitejs/plugin-vue` and others use port 24678 for HMR. The WS upgrade handler coexists with it — no port conflict.

## Key Imports

```ts
// Default export — the plugin factory
import rudderjs from '@rudderjs/vite'

// Plugin-specific types (rarely needed in app code)
import type { Plugin } from 'vite'
```
