# @rudderjs/router

Decorator-based routing — `@Controller`, `@Get/@Post/@Put/@Patch/@Delete`, `@Middleware`, signed URLs.

## Key Files

- `src/index.ts` — `Router`, route decorators, `route()` URL generator, `Url` signed URLs, signature validation middleware

## Architecture Rules

- **Peer of core**: uses `peerDependencies` for `@rudderjs/core` — never add core to `dependencies` (cycle)
- **Decorator metadata**: requires `reflect-metadata`, `experimentalDecorators`, `emitDecoratorMetadata`
- **Route registration**: decorators collect metadata; `Router` reads it during boot
- **Route bindings**: `router.bind(name, resolver)` registers a duck-typed `RouteResolver` (anything with `name: string` + `findForRoute(value)`). Resolution runs as per-route middleware injected at `mount()` time — only on routes whose path contains a `:name` segment matching a binding. Resolved values land on `req.bound[name]`; raw strings stay in `req.params[name]`. Missing-record throws `RouteModelNotFoundError`. Router does NOT depend on `@rudderjs/orm` — Models match the resolver shape via `static routeKey` + `static findForRoute`.

## Commands

```bash
pnpm build      # tsc
pnpm typecheck  # tsc --noEmit
```
