# @rudderjs/router

Decorator-based routing — `@Controller`, `@Get/@Post/@Put/@Patch/@Delete`, `@Middleware`, signed URLs.

## Key Files

- `src/index.ts` — `Router`, route decorators, `route()` URL generator, `Url` signed URLs, signature validation middleware

## Architecture Rules

- **Peer of core**: uses `peerDependencies` for `@rudderjs/core` — never add core to `dependencies` (cycle)
- **Decorator metadata**: requires `reflect-metadata`, `experimentalDecorators`, `emitDecoratorMetadata`
- **Route registration**: decorators collect metadata; `Router` reads it during boot
- **Route bindings**: `router.bind(name, resolver)` registers a duck-typed `RouteResolver` (anything with `name: string` + `findForRoute(value)`). Resolution runs as per-route middleware injected at `mount()` time — only on routes whose path contains a `:name` segment matching a binding. Resolved values land on `req.bound[name]`; raw strings stay in `req.params[name]`. Missing-record throws `RouteModelNotFoundError`. Router does NOT depend on `@rudderjs/orm` — Models match the resolver shape via `static routeKey` + `static findForRoute`.
- **Typed `route()` URL generator**: `RouteRegistry` interface (exported, empty by default) is augmented by apps to map named-route IDs → literal path strings. `route<N extends string>(name, params)` then narrows `params` via `ParamsForName<N>` when `N` lands in `keyof RouteRegistry`. Soft name strictness (typos fall through to loose params + runtime throw) keeps framework internals + runtime-registered routes working. Apps wanting strict name-checks wrap `route()` in a `<N extends keyof RouteRegistry>` helper.
- **Introspectable route schemas (typed-responses/OpenAPI arc, Phase 1)**: `RouteDefinition` (in `@rudderjs/contracts`) retains `name` / `bodySchema` / `querySchema` / `responses` so a downstream emitter (the planned `@rudderjs/openapi` package) can read them. `.body(schema)` / `.query(schema)` stash the RAW schema on the definition IN ADDITION to installing the validator middleware (validation unchanged); `.name()` mirrors the name onto the definition. **`.responds(status?, schema, opts?)`** declares per-status response shapes — a **contract declaration only** (no runtime response validation in v1). The schema params type against **`StandardSchemaV1`** (from contracts — the `~standard` interface Zod 4 / Valibot / ArkType all implement), NOT `ZodType`, so the typed surface isn't locked to Zod (Zod stays the default; a zod schema satisfies `StandardSchemaV1` structurally). `StandardSchemaV1` is inlined in contracts (types-only, keeps its no-dep invariant) — swap to `@standard-schema/spec` later without a code change. Existing `.body()`/`.query()` still type against `ZodType` + `z.infer` (migrating them to Standard Schema is a deferred follow-up — see `docs/plans/2026-06-08-typed-responses-openapi.md`).

## `route:list --verbose`

`commands/route-list.ts` accepts `--verbose` (or `-v`) for the resolved `[global → group → route]` middleware stack matching the request-time composition. Reads the snapshot from `__rudderjs_instance__.middlewareSnapshot()` (duck-typed globalThis read — keeps router free of a hard `@rudderjs/core` import). `--verbose --json` includes a `resolved: { global, group, route }` triple per api route. Default (non-verbose) output is unchanged.

## Commands

```bash
pnpm build      # tsc
pnpm typecheck  # tsc --noEmit
```
