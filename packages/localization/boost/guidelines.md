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
import { localization } from '@rudderjs/localization'
export default [localization(configs.localization), ...]
```

### Translation lookup

```ts
import { trans, __ } from '@rudderjs/localization'

trans('messages.welcome', { app: 'RudderJS' })   // 'Welcome to RudderJS!'
__('messages.greeting', { name: 'Alice' })        // alias — same thing

// With count for pluralization
trans('messages.items', { count: 5 })             // '5 items'
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
import { setLocale, getLocale } from '@rudderjs/localization'

// In middleware
await setLocale(req.user?.preferredLocale ?? 'en', async () => {
  // All trans() calls inside this block use the set locale
  return next()
})

// Read current locale
const locale = getLocale()  // 'en' by default
```

`setLocale()` uses AsyncLocalStorage — scoped to the async chain, not global. Safe in concurrent request handling.

### Global fallback

If a key is missing in the current locale, the `fallback` locale is tried. If still missing, the key itself is returned (makes missing translations visible in the UI).

## Common Pitfalls

- **Missing `path` config.** Translations won't load. Set `path` to an absolute path — relative paths break under different working directories.
- **`trans()` outside middleware.** If you never wrapped with `setLocale()`, it uses `config.locale` (the default). CLI commands and jobs need to call `setLocale()` manually if they should use a non-default locale.
- **Nested JSON keys with dots.** `messages.welcome` looks up `messages.json` → key `welcome`. `messages.user.name` looks up `messages.json` → key `user.name`, NOT nested `user` → `name`. Flat keys only in JSON files.
- **Interpolation typos.** `:name` in the template but `{ Name: 'Alice' }` in code = literal `:name` in output (no error). Case matters.
- **Loading at startup.** The provider reads all translation files at boot. Adding/editing a translation file requires a restart — or dev HMR via `@rudderjs/vite`'s `rudderjs:routes` watcher.
- **Client-side translations.** This package is server-only. For client-side i18n, flow the current locale's translations through SSR props to the view (e.g. via `view('page', { t: translations })`).

## Key Imports

```ts
import { localization, trans, __, setLocale, getLocale } from '@rudderjs/localization'

import type { LocalizationConfig } from '@rudderjs/localization'
```
