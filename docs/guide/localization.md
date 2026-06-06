# Localization

`@rudderjs/localization` translates strings against JSON language files. It supports named interpolation, plural rules, fallback locales, and request-scoped locale switching via AsyncLocalStorage — so a Spanish-speaking user's request renders Spanish strings without leaking that locale to other in-flight requests.

## Setup

```bash
pnpm add @rudderjs/localization
```

Create JSON language files:

```
lang/
├── en/
│   └── messages.json
├── es/
│   └── messages.json
└── ar/
    └── messages.json
```

```json
// lang/en/messages.json
{
  "welcome":  "Welcome to :app!",
  "greeting": "Hello, :name!",
  "items":    "{0} no items|{1} one item|{n} :count items"
}
```

```ts
// config/localization.ts
import { resolve } from 'node:path'
import { Env } from '@rudderjs/support'

export default {
  locale:   Env.get('APP_LOCALE', 'en'),
  fallback: 'en',
  path:     resolve(process.cwd(), 'lang'),
}
```

The provider is auto-discovered.

## Translating

```ts
import { trans } from '@rudderjs/localization'

await trans('messages.welcome', { app: 'Rudder' })   // 'Welcome to Rudder!'
await trans('messages.greeting', { name: 'Alice' })    // 'Hello, Alice!'
await trans('messages.items', 3)                        // '3 items'
```

For sync lookups (cache-only, returns the key on miss), use `__()`:

```ts
import { __ } from '@rudderjs/localization'

__('messages.greeting', { name: 'Alice' })
```

> Always use `trans()` inside Vike `+data.ts` files — `__()` is sync and won't load a namespace that hasn't been touched yet. Inside route handlers and middleware, `__()` is fine after the namespace has been loaded once.

## Pluralization

Two shapes are supported:

```json
{
  "apple_count": "one apple|many apples",
  "items":       "{0} no items|{1} one item|{n} :count items"
}
```

```ts
await trans('messages.items', 0)   // 'no items'
await trans('messages.items', 1)   // 'one item'
await trans('messages.items', 12)  // '12 items'
```

`{0}` and `{1}` match those exact counts; `{n}` is the fallback for any other count. The two-form `one|many` shape selects `one` for a count of `1` and `many` otherwise. Counts pass as the second argument; if you need both a count and named placeholders, pass `{ count: 3, name: 'Alice' }`.

## Per-request locale

Per-request locale switching is AsyncLocalStorage-based, but the API is `runWithLocale(locale, fn)` (the scoped form), not `setLocale()` (which mutates the global default).

The simplest path is to mount `LocalizationMiddleware()` — it reads `Accept-Language` and wraps the rest of the request in `runWithLocale()` automatically:

```ts
import { LocalizationMiddleware } from '@rudderjs/localization'

.withMiddleware((m) => {
  m.use(LocalizationMiddleware())
})
```

To switch locales mid-request (e.g. inside a sign-in flow that learns the user's preferred locale from the database), call `runWithLocale()`:

```ts
import { runWithLocale, getLocale } from '@rudderjs/localization'

Route.post('/login', async (req) => {
  const user = await authenticate(req)
  return runWithLocale(user.preferredLocale, async () => {
    return view('dashboard.welcome', {
      currentLocale: getLocale(),  // user's locale, scoped to this callback
    })
  })
})
```

`setLocale('es')` exists too, but it mutates the global default — useful in CLI commands or test setup, dangerous in concurrent request handling.

## Multiple namespaces

Each filename in `lang/<locale>/` is a namespace. Reference keys with `namespace.key`:

```
lang/en/auth.json       → trans('auth.login.success')
lang/en/messages.json   → trans('messages.welcome')
lang/en/validation.json → trans('validation.required')
```

The framework loads namespaces lazily on first access — `trans('messages.welcome')` reads `messages.json` once and caches it.

## Validation messages

If `lang/<locale>/validation.json` exists, `@rudderjs/core`'s validator uses it for error messages:

```json
{
  "required": ":field is required.",
  "email":    ":field must be a valid email address."
}
```

The validator passes `:field` automatically. See [Validation](/guide/validation).

## Pitfalls

- **`__()` in `+data.ts`.** Sync lookup miss returns the key, not the translation. Use `trans()` (async) so the namespace can load on first access.
- **Locale leaking across requests.** Don't call `setLocale()` per-request — it mutates the global default, not request-scoped state. Use `LocalizationMiddleware()` (auto) or `runWithLocale()` (manual) for per-request scoping.
- **Plural matching order.** Specific counts (`{0}`, `{1}`) must come before the `{n}` fallback — the matcher takes the first matching segment.
