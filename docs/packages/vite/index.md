# @rudderjs/vite

Vite plugin that wires up [Vike](https://vike.dev), the `@/` path alias, and SSR externals — all from a single call.

## Installation

```bash
pnpm add @rudderjs/vite
```

## Usage

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

`rudderjs()` is placed first so Vike initialises before the UI framework plugins run.

## What it does

| Feature | Details |
|---|---|
| **Vike** | Registers `vike/plugin` from the app's own `node_modules` — guaranteed single instance, no double-registration |
| **View scanner** | Scans `app/Views/**` and generates virtual Vike pages under `pages/__view/` for `@rudderjs/view` |
| **HMR route reload** | Watches `routes/`, `bootstrap/`, and `app/` so edits invalidate the SSR module graph without restarting the dev server |
| **`@/` / `App/` aliases** | Resolves `@/` and `App/` to the app directory in both client and SSR builds |
| **SSR externals** | Keeps optional RudderJS peers and Node-only drivers out of the SSR bundle — see list below |
| **WebSocket upgrade** | Intercepts `http.createServer` to attach `__rudderjs_ws_upgrade__` for `@rudderjs/broadcast` and `@rudderjs/live` |
| **`x-real-ip` injection (dev)** | Populates the header from the Node socket so `req.ip` works through Vike's universal middleware |

### Plugins produced

| Plugin | Purpose |
|---|---|
| `rudderjs:config` | SSR externals, path alias, warning suppression |
| `rudderjs:ws` | WebSocket upgrade handler via `configureServer` |
| `rudderjs:ip` | Dev-only `x-real-ip` injection from Node socket |
| `rudderjs:routes` | HMR watcher for `routes/` + `bootstrap/` + `app/`; invalidates SSR modules + clears `__rudderjs_instance__` and `__rudderjs_app__` globals so the next request re-bootstraps cleanly |
| `rudderjs:views` | View scanner — generates virtual Vike pages from `app/Views/**` |
| *(vike plugins)* | SSR rendering, file-based routing (auto-registered) |

### HMR notes

- `rudderjs:routes` never calls `server.restart()` — doing so closes Vite's module runner and breaks in-flight SSR requests. Module invalidation + globalThis cleanup is enough to force a full re-bootstrap on the next request.
- Changes under `app/` require the full cleanup (not just invalidation) because models, controllers, and resources are captured in provider closures during boot.

## UI frameworks

`rudderjs()` does **not** include a UI framework plugin — add the one you need alongside it:

```ts
// React
import react from '@vitejs/plugin-react'
plugins: [rudderjs(), react()]

// Vue
import vue from '@vitejs/plugin-vue'
plugins: [rudderjs(), vue()]

// Solid
import solid from 'vike-solid/vite'
plugins: [rudderjs(), solid()]

// Multiple frameworks (scope with include / exclude)
plugins: [
  rudderjs(),
  react({ exclude: ['**/pages/solid*/**'] }),
  solid({ include: ['**/pages/solid*/**'] }),
  vue(),
]
```

## SSR externals list

The following packages are automatically excluded from the SSR bundle (Node.js-only, must not be shipped to the browser):

| Category | Packages |
|---|---|
| RudderJS queue adapters | `@rudderjs/queue-inngest`, `@rudderjs/queue-bullmq` |
| RudderJS ORM | `@rudderjs/orm-drizzle` |
| RudderJS storage | `@rudderjs/storage` |
| RudderJS CLI | `@clack/core`, `@clack/prompts` |
| Database drivers | `pg`, `mysql2`, `better-sqlite3` |
| Prisma adapters | `@prisma/adapter-pg`, `@prisma/adapter-mysql2`, `@prisma/adapter-better-sqlite3`, `@prisma/adapter-libsql`, `@libsql/client` |
| Redis | `ioredis` |

`@rudderjs/server-hono` is kept **non-external** (`ssr.noExternal`) so Vite processes its virtual module imports correctly.

## Notes

- `rudderjs()` returns a `Promise` — Vite handles it natively. No `await` or spread (`...`) needed.
- The plugin loads Vike via a dynamic `import()` resolved from `process.cwd()`, ensuring only one Vike instance is ever registered even in monorepos where multiple `node_modules/vike` copies exist.
- SSR externals are applied to both `ssr.external` (dev) and `build.rollupOptions.external` (production).
