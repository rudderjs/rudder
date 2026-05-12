# @rudderjs/vite

Vite plugin for RudderJS. Registers Vike (SSR), sets the `@/` and `App/` path aliases, externalizes server-only packages from the client bundle, wires up WebSocket upgrade handling for `@rudderjs/broadcast` and `@rudderjs/sync`, and installs Vike framework hooks (page-context enhancers, error routing, per-page response headers) so other `@rudderjs/*` packages can light up their Vike integrations automatically.

```bash
pnpm add @rudderjs/vite
```

---

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

That's it. `rudderjs()` handles:

- **Vike registration** — auto-detects and registers `vike/plugin` for SSR + file-based routing
- **View scanner** — scans `app/Views/**` and generates virtual Vike pages under `pages/__view/` for `@rudderjs/view`
- **Vike framework hooks** — writes `+onCreatePageContext.ts`, `+onError.ts`, and `+headersResponse.ts` stubs into `pages/` on first sync, wiring the page-context enhancer registry, error reporting through `@rudderjs/core`, and per-page response headers from `view(id, props, { headers })`
- **HMR route reload** — watches `routes/`, `bootstrap/`, and `app/` so edits there invalidate the SSR module graph without restarting the dev server
- **Path alias** — `@/` and `App/` resolve to the app directory
- **SSR externals** — server-only packages (database drivers, Redis, queue adapters, storage, image) are externalized from the client bundle
- **SSR no-externals** — `@rudderjs/server-hono` is forced non-external so Vite processes virtual module imports
- **WebSocket upgrade** — intercepts `http.createServer` to attach the `__rudderjs_ws_upgrade__` handler for `@rudderjs/broadcast` and `@rudderjs/sync`
- **`x-real-ip` injection** — dev-only, populates the header from the Node socket so `req.ip` works through Vike's universal middleware
- **Sourcemap warnings** — suppresses noisy "missing source files" warnings for `@rudderjs/*` packages
- **Build externals** — server-only packages are excluded from production builds

## What it produces

Six Vite plugins (plus Vike's own):

| Plugin | Purpose |
|--------|---------|
| `rudderjs:config` | SSR externals, path alias, warning suppression |
| `rudderjs:ws` | WebSocket upgrade handler via `configureServer` |
| `rudderjs:ip` | Dev-only `x-real-ip` injection from Node socket |
| `rudderjs:routes` | HMR watcher for `routes/` + `bootstrap/` + `app/`; invalidates SSR modules + clears `__rudderjs_instance__` and `__rudderjs_app__` globals so the next request re-bootstraps cleanly |
| `rudderjs:views` | View scanner — generates virtual Vike pages from `app/Views/**` and seeds top-level Vike hook stubs in `pages/` |
| *(vike plugins)* | SSR rendering, file-based routing (auto-registered) |

### HMR notes

- `rudderjs:routes` never calls `server.restart()` — doing so closes Vite's module runner and breaks in-flight SSR requests. Module invalidation + globalThis cleanup is enough to force a full re-bootstrap on the next request.
- Changes under `app/` require the full cleanup (not just invalidation) because models, controllers, and resources are captured in provider closures during boot.

## Vike framework hooks

On first sync, the view scanner writes three top-level Vike hook files to `pages/` — each is a one-line re-export from `@rudderjs/vite`:

| File | Re-exports from | What it does |
|---|---|---|
| `pages/+onCreatePageContext.ts` | `@rudderjs/vite/hooks/onCreatePageContext` | Runs every registered page-context enhancer (see below) on every page render |
| `pages/+onError.ts` | `@rudderjs/vite/hooks/onError` | Routes Vike SSR errors through `@rudderjs/core`'s `report()` pipeline (falls back to `console.error` if core isn't installed) |
| `pages/+headersResponse.ts` | `@rudderjs/vite/hooks/headersResponse` | Reads response headers off `pageContext.viewHeaders` (set by `view(id, props, { headers })` in `@rudderjs/view`) |

Stubs are written **only if missing** — edit any file in place and your version wins on subsequent syncs. Need to replace one entirely? Just overwrite it. Want to keep the framework default but add your own logic? Re-export and wrap.

### Page-context enhancers

`@rudderjs/vite/page-context-enhancers` is the registry that backs `+onCreatePageContext`. Framework packages register enhancers from their provider's `boot()` so per-request state lands on every `pageContext` without per-view boilerplate:

| Package | Adds to `pageContext` |
|---|---|
| `@rudderjs/auth` | `pageContext.user` — current authenticated user (or `null`) |
| `@rudderjs/session` | `pageContext.flash` — flash bag carried over from the previous request |
| `@rudderjs/localization` | `pageContext.locale` — resolved locale for the current request |

Custom enhancers live in app code — typically a service provider — and use the same registry:

```ts
import { registerPageContextEnhancer } from '@rudderjs/vite/page-context-enhancers'

registerPageContextEnhancer(async (pageContext) => {
  pageContext.tenant = await resolveTenantForRequest()
})
```

Enhancers run in registration order on every render and should be fast.

## SSR Externals

These packages are externalized from the SSR bundle (Node.js-only, not browser-compatible):

- `@rudderjs/view` (linked-package workaround for fresh scaffolds)
- `@rudderjs/queue-inngest`, `@rudderjs/queue-bullmq`
- `@rudderjs/orm-drizzle`, `@rudderjs/orm-prisma`
- `@rudderjs/storage`, `@rudderjs/image`
- Database drivers: `pg`, `mysql2`, `better-sqlite3`, `@prisma/adapter-*`, `@libsql/client`
- Redis: `ioredis`
- CLI prompts: `@clack/core`, `@clack/prompts`
- Optional icon adapters: `@tabler/icons-react`, `@phosphor-icons/react`, `@remixicon/react`

## Peer Dependencies

| Package | Required | Notes |
|---------|----------|-------|
| `vite` | Yes | Build tool |
| `vike` | Yes | SSR framework |
| `@rudderjs/core` | Optional | Used by `+onError` to route SSR errors through `report()`; falls back to `console.error` if missing |
| `@vitejs/plugin-react` | Optional | For React projects |
| `@vitejs/plugin-vue` | Optional | For Vue projects |
| `vike-solid` | Optional | For Solid projects |

## Subpath exports

The hook implementations and the enhancer registry ship as subpath exports so the generated stubs (and your own code) can import them directly:

```ts
import { registerPageContextEnhancer } from '@rudderjs/vite/page-context-enhancers'
import { onCreatePageContext }          from '@rudderjs/vite/hooks/onCreatePageContext'
import { onError }                      from '@rudderjs/vite/hooks/onError'
import { headersResponse }              from '@rudderjs/vite/hooks/headersResponse'
```

## Framework Plugins

Add your UI framework plugin separately — `rudderjs()` does not include one:

```ts
// React
import react from '@vitejs/plugin-react'
plugins: [rudderjs(), react()]

// Vue
import vue from '@vitejs/plugin-vue'
plugins: [rudderjs(), vue()]

// Solid
import solid from 'vite-plugin-solid'
plugins: [rudderjs(), solid()]
```
