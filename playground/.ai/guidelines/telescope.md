# @rudderjs/telescope — AI Coding Guidelines

## What This Package Does

Telescope is a development inspector for RudderJS applications. It records requests, queries, jobs, exceptions, logs, mail, notifications, events, cache operations, scheduled tasks, and model changes — providing a JSON API and (future) UI for introspection.

## Architecture

Three layers:
1. **Collectors** — Middleware, event listeners, and hooks that passively record app activity
2. **Storage** — In-memory (default) or SQLite backend for entry persistence
3. **API** — RESTful JSON endpoints at `/{path}/api/*`

## Key Patterns

- Each collector implements the `Collector` interface with `register()` method
- Collectors hook into framework subsystems via dynamic imports (graceful skip if not installed)
- All entries share the `TelescopeEntry` shape with `type`, `content` (JSON), and `tags`
- Related entries within a request share a `batchId` for correlation
- Storage is accessed via `TelescopeRegistry.get()` or the `Telescope` facade

## Common Tasks

### Adding a new collector
1. Create `src/collectors/my-collector.ts` implementing `Collector`
2. Use dynamic `import()` to hook into the relevant package
3. Store entries via `storage.store(createEntry(type, content, options))`
4. Register in `src/index.ts` provider boot

### Extending the API
1. Add route in `src/api/routes.ts` using `router.get/post/delete()`
2. Follow existing pattern: parse query params, call storage, return JSON

## Do NOT

- Import peer dependencies statically — always use dynamic `import()` with try/catch
- Record Telescope's own API requests (the request collector ignores `/telescope*`)
- Block the request pipeline — storage writes are fire-and-forget
