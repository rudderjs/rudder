# @boostkit/localization

Laravel-style localization for BoostKit. JSON translation files, named interpolation, pluralization, and per-request locale via AsyncLocalStorage.

```bash
pnpm add @boostkit/localization
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
import { localization } from '@boostkit/localization'
import configs from '../config/index.js'

export default [
  localization(configs.localization),
]
```

---

## Usage

### __() - synchronous (cache only)

```ts
import { __ } from '@boostkit/localization'

__('messages.welcome', { app: 'BoostKit' }) // 'Welcome to BoostKit!'
__('messages.items', 3) // '3 items'
```

Returns the key string if not found. Use __() when the namespace is already loaded.

### trans() - async (loads from disk)

```ts
import { trans } from '@boostkit/localization'

await trans('messages.greeting', { name: 'Alice' }) // 'Hello, Alice!'
await trans('messages.items', 0) // 'no items'
```

Loads the namespace JSON from disk on first call, then caches in memory.

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
import { getLocale, setLocale, LocalizationMiddleware } from '@boostkit/localization'

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
