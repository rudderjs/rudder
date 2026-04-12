# @rudderjs/core

The framework kernel — Application lifecycle, DI container, service providers, events, validation, and exception handling.

## Key Files

- `src/application.ts` — `Application`, `AppBuilder`, `RudderJS` singleton, boot lifecycle
- `src/di.ts` — `Container`, `@Injectable`, `@Inject`, contextual bindings, scoped (AsyncLocalStorage)
- `src/service-provider.ts` — `ServiceProvider` base class, `PublishGroup`, dedup guard
- `src/events.ts` — `EventDispatcher`, `eventsProvider()`, wildcard listeners
- `src/validation.ts` — `FormRequest`, `ValidationError`, zod integration
- `src/exceptions.ts` — `HttpException`, `abort()`, `report()`
- `src/default-providers.ts` — `defaultProviders()` auto-discovery from manifest
- `src/provider-sort.ts` — Stage + topo sort: foundation → infrastructure → feature → monitoring

## Architecture Rules

- **Singleton app**: `app()` returns the global `Application` instance
- **Provider lifecycle**: `register()` → bindings only; `boot()` → logic + can register more providers
- **Deferred providers**: return tokens from `$defer()`, boot lazily on first `resolve()`
- **Scoped bindings**: per-request via `AsyncLocalStorage` (lazy-loaded, server-only)
- **No circular deps**: `@rudderjs/router` is loaded at runtime via `resolveOptionalPeer()` — never add it to `dependencies`

## Commands

```bash
pnpm build      # tsc
pnpm dev        # tsc --watch
pnpm typecheck  # tsc --noEmit
pnpm test       # tsx --test
```

## Pitfalls

- `reflect-metadata` must be imported at the app entry point, not here
- Re-exports `@rudderjs/rudder`, `@rudderjs/support`, `@rudderjs/contracts` — changes there affect this package's public API
- `AsyncLocalStorage` is lazy-loaded inside functions — never import `node:async_hooks` at top level
