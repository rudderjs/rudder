# @rudderjs/localization

Laravel-style localization for RudderJS. JSON translation files, named interpolation, pluralization, and per-request locale via AsyncLocalStorage.

```bash
pnpm add @rudderjs/localization
```

---

## Setup

### 1. Create lang files

```text
lang/
  en/
    messages.json
  es/
    messages.json
```

```json
{
  "welcome": "Welcome to :app!",
  "greeting": "Hello, :name!",
  "items": "{0} no items|{1} one item|{n} :count items"
}
```

### 2. Add config

```ts
// config/localization.ts
import { resolve } from 'node:path'

export default {
  locale: 'en',
  fallback: 'en',
  path: resolve(import.meta.dirname, '../lang'),
}
```

### 3. Register provider

```ts
// bootstrap/providers.ts
import { localization } from '@rudderjs/localization'
import configs from '../config/index.js'

export default [
  localization(configs.localization),
]
```

---

## Usage

### __() - synchronous (cache only)

```ts
import { __ } from '@rudderjs/localization'

__('messages.welcome', { app: 'RudderJS' }) // 'Welcome to RudderJS!'
__('messages.items', 3) // '3 items'
```

Returns the key string if not found. Use __() when the namespace is already loaded.

### trans() - async (loads from disk)

```ts
import { trans } from '@rudderjs/localization'

await trans('messages.greeting', { name: 'Alice' }) // 'Hello, Alice!'
await trans('messages.items', 0) // 'no items'
```

Loads the namespace JSON from disk on first call, then caches in memory.

> **Vike / SSR note:** Always use `trans()` (not `__()`) in Vike `+data.ts` files. The registry config and translation cache are stored on `globalThis` so they survive Vike's SSR module isolation. `__()` is safe inside middleware and request handlers that run after the namespace is already loaded.

---

## Pluralization

Use pipe-separated forms in JSON values:

```json
{ "apples": "{0} no apples|{1} one apple|{n} :count apples" }
```

```ts
await trans('messages.apples', 0) // 'no apples'
await trans('messages.apples', 1) // 'one apple'
await trans('messages.apples', 12) // '12 apples'
```

Simple two-part form also works:

```json
{ "item": "one item|many items" }
```

```ts
await trans('messages.item', 1) // 'one item'
await trans('messages.item', 5) // 'many items'
```

---

## Locale switching

```ts
import { getLocale, setLocale, LocalizationMiddleware } from '@rudderjs/localization'

getLocale() // 'en'
setLocale('es')
LocalizationMiddleware()
```

setLocale() only works inside a request context (within runWithLocale()).

---

## Nested keys

```json
{
  "nav": {
    "home": "Home",
    "profile": "My Profile"
  }
}
```

```ts
__('messages.nav.home') // 'Home'
__('messages.nav.profile') // 'My Profile'
```

---

## Fallback locale

If a key is missing in the current locale, resolution automatically falls back to the configured fallback locale.
