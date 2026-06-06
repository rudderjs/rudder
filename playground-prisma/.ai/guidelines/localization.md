# @rudderjs/localization

## Overview

Laravel-style localization — JSON translation files, named interpolation (`:name`), pluralization rules, per-request locale via AsyncLocalStorage. Provides `trans()` / `__()` helpers and the `setLocale()` facade. No client-side runtime — translations resolve server-side and flow through SSR props.

## Key Patterns

### Setup

```ts
// Translation files
// lang/en/messages.json
{ "welcome": "Welcome to :app!", "greeting": "Hello, :name!" }
// lang/es/messages.json
{ "welcome": "¡Bienvenido a :app!", "greeting": "¡Hola, :name!" }

// config/localization.ts
import { resolve } from 'node:path'

export default {
  locale:   'en',
  fallback: 'en',
  path:     resolve(import.meta.dirname, '../lang'),
}

// bootstrap/providers.ts
import { LocalizationProvider } from '@rudderjs/localization'
export default [LocalizationProvider]
```

### Translation lookup

`trans()` is **async** — it lazy-loads the namespace JSON before resolving. `__()` is sync but only reads from the in-memory cache; if the namespace hasn't been loaded yet, it returns the key as-is.

```ts
import { trans, __, preloadNamespace } from '@rudderjs/localization'

await trans('messages.welcome', { app: 'RudderJS' })  // 'Welcome to RudderJS!'
await trans('messages.items',   5)                    // pluralized — pass a number for count

// __() only resolves from already-loaded namespaces; preload first if you need sync access
await preloadNamespace('en', 'messages')
__('messages.greeting', { name: 'Alice' })           // sync — works because messages is preloaded
```

### Pluralization

Translation files use Laravel's pipe syntax:

```json
{
  "items": "{0} no items|{1} one item|{n} :count items"
}
```

- `{0}` → exact match for 0
- `{1}` → exact match for 1
- `{n}` → fallback for any other count
- Range syntax: `[1,4] a few items|[5,*] many items`

### Per-request locale

```ts
import { setLocale, getLocale, runWithLocale, LocalizationMiddleware } from '@rudderjs/localization'

// Read current locale
const locale = getLocale()  // 'en' by default

// Set globally (mutates the global default — use sparingly outside tests)
setLocale('es')

// Scoped — runs `fn` with the given locale active in the current async chain
await runWithLocale('es', async () => {
  return await trans('messages.welcome', { app: 'RudderJS' })  // resolves in 'es'
})

// Built-in middleware reads Accept-Language and wraps the request in runWithLocale()
m.web(LocalizationMiddleware())
```

`runWithLocale()` uses AsyncLocalStorage — scoped to the async chain, not global. Safe in concurrent request handling. There is no callback form of `setLocale()`; use `runWithLocale()` for scoped switches.

### Global fallback

If a key is missing in the current locale, the `fallback` locale is tried. If still missing, the key itself is returned (makes missing translations visible in the UI).

## Common Pitfalls

- **Missing `path` config.** Translations won't load. Set `path` to an absolute path — relative paths break under different working directories.
- **`trans()` outside middleware.** If you never entered a `runWithLocale()` scope, it uses `config.locale` (the default). CLI commands and jobs need to wrap their work in `runWithLocale(locale, fn)` if they should use a non-default locale.
- **Nested JSON keys with dots.** `messages.welcome` looks up `messages.json` → key `welcome`. `messages.user.name` looks up `messages.json` → key `user.name`, NOT nested `user` → `name`. Flat keys only in JSON files.
- **Interpolation typos.** `:name` in the template but `{ Name: 'Alice' }` in code = literal `:name` in output (no error). Case matters.
- **Loading at startup.** The provider reads all translation files at boot. Adding/editing a translation file requires a restart — or dev HMR via `@rudderjs/vite`'s `rudderjs:routes` watcher.
- **Client-side translations.** This package is server-only. For client-side i18n, flow the current locale's translations through SSR props to the view (e.g. via `view('page', { t: translations })`).

## Key Imports

```ts
import {
  LocalizationProvider,
  LocalizationMiddleware,
  trans,
  __,
  setLocale,
  getLocale,
  runWithLocale,
  preloadNamespace,
} from '@rudderjs/localization'

import type { LocalizationConfig } from '@rudderjs/localization'
```
