# @rudderjs/core

The framework kernel — Application lifecycle, DI container, service providers, events, validation, and exception handling.

## Key Files

- `src/application.ts` — `Application`, `AppBuilder`, `RudderJS` singleton, boot lifecycle
- `src/di.ts` — `Container`, `@Injectable`, `@Inject`, `@Tag`, `tagToken`, contextual bindings, scoped (AsyncLocalStorage), tagging (`tag`/`tagged`), `extend`, `rebinding`, conditional binding (`bindIf`/`singletonIf`/`scopedIf`)
- `src/service-provider.ts` — `ServiceProvider` base class, `PublishGroup`, dedup guard
- `src/events.ts` — `EventDispatcher`, `eventsProvider()`, wildcard listeners
- `src/validation.ts` — `FormRequest` (with lifecycle hooks: `prepareForValidation`, `messages`, `after`, `passedValidation`, `failedValidation`), `ValidationError`, `ValidationResponse`, zod integration
- `src/exceptions.ts` — `HttpException`, `abort()`, `report()`
- `src/default-providers.ts` — `defaultProviders()` auto-discovery from manifest
- `src/provider-sort.ts` — Stage + topo sort: foundation → infrastructure → feature → monitoring

## Architecture Rules

- **Singleton app**: `app()` returns the global `Application` instance
- **Provider lifecycle**: `register()` → bindings only; `boot()` → logic + can register more providers
- **Deferred providers**: return tokens from `$defer()`, boot lazily on first `resolve()`
- **Scoped bindings**: per-request via `AsyncLocalStorage` (lazy-loaded, server-only)
- **No circular deps**: `@rudderjs/router` is loaded at runtime via `resolveOptionalPeer()` — never add it to `dependencies`
- **Client-safe surface lives at `@rudderjs/core/client`** (`src/client.ts`): the main `.` entry re-exports `@rudderjs/console` (→ `@clack/*` static `node:` imports) + Node-only modules (`default-providers` reads the manifest via `node:fs`, `events-fake` uses `node:assert`, support's `resolveOptionalPeer`/`dump`/`dd`), so it crashes in a browser bundle. `/client` re-exports only the node-free symbols (`app`, `resolve`, `Env`, `env`, `config`, `Container` + DI, validation, exceptions, `ServiceProvider`, events, contracts types). **Anything client-reachable must import from `@rudderjs/core/client`, not `@rudderjs/core`.** Keep `client.ts` free of console/CLI re-exports and static `node:` imports — the `Client Bundle Smoke` CI gate (`scripts/client-bundle-smoke.mjs`) `export *`s it through esbuild + a no-`process` vm and fails on any Node-at-eval. Lazy `await import('node:x')` inside a function is fine (never runs at eval).

## Introspection commands

Two subpath-exported commands the CLI registers via `tryImport` after `bootApp()` runs:

- `commands/event-list` — `event:list`. Walks `dispatcher.inspect()` (additive to the count-only `dispatcher.list()`); registers `registerEventListCommand(rudder)`. Wildcard `*` and `<anonymous>` listener handling.
- `commands/config-show` — `config:show [section[.key]]`. Reads `getConfigRepository().all()`, splits camelCase/snake_case/dotted keys into tokens, redacts when the final token is one of `key/secret/password/token/dsn/webhook/signing/salt/pepper/credentials`. `--raw` disables redaction with a stderr warning; `--json` round-trips through redaction.

`RudderJS.middlewareSnapshot()` is consumed by `@rudderjs/router`'s `route:list --verbose` — returns `{ global, groups: { web, api } }` resolved against the current user-side `withMiddleware()` block + provider-registered `appendToGroup()` middleware. Idempotent re-construction of `MiddlewareConfigurator`; safe to call repeatedly.

## Commands

```bash
pnpm build      # tsc
pnpm dev        # tsc --watch
pnpm typecheck  # tsc --noEmit
pnpm test       # tsx --test
```

## Pitfalls

- `reflect-metadata` must be imported at the app entry point, not here
- Re-exports `@rudderjs/console`, `@rudderjs/support`, `@rudderjs/contracts` — changes there affect this package's public API
- `AsyncLocalStorage` is lazy-loaded inside functions — never import `node:async_hooks` at top level
