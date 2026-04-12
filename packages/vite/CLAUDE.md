# @rudderjs/vite

Vite build plugin — configures Vike SSR, path aliases, SSR externals, view scanner, and HMR route reloading.

## Key Files

- `src/index.ts` — Main plugin factory returning `Plugin[]`
- View scanner generates Vike pages at `pages/__view/` from `app/Views/`
- `rudderjs:routes` plugin watches `routes/` and `bootstrap/` for HMR invalidation

## Architecture Rules

- **Async plugin**: returns `Promise<Plugin[]>` — loads Vike dynamically from the app root
- **Path aliases**: `@/` and `App/` mapped to app directory
- **SSR externals**: node built-ins (`node:*`) externalized — never import them at top level in client code
- **HMR reload**: invalidates SSR module graph on route/bootstrap changes; never uses `server.restart()`
- **GlobalThis cleanup**: clears `__rudderjs_instance__` and `__rudderjs_app__` on re-bootstrap

## Commands

```bash
pnpm build      # tsc
pnpm typecheck  # tsc --noEmit
```

## Pitfalls

- Only one vike renderer (vike-react/vue/solid) can be installed at a time
- View scanner is lazy — only activates when `app/Views/` exists
