# @rudderjs/localization

Laravel-style localization for RudderJS. JSON translation files, named interpolation, pluralization, and per-request locale via AsyncLocalStorage.

## Installation

```bash
pnpm add @rudderjs/localization
```

## Setup

### 1. Create language files

```text
lang/
  en/
    messages.json
  es/
    messages.json
```

```json
// lang/en/messages.json
{
  "welcome": "Welcome to :app!",
  "greeting": "Hello, :name!",
  "items": "{0} no items|{1} one item|{n} :count items"
}
```

### 2. Add localization config

```ts
// config/localization.ts
import { resolve } from 'node:path'
import { Env } from '@rudderjs/core'

export default {
  locale: Env.get('APP_LOCALE', 'en'),
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

## Usage

### __() - synchronous, cache-only lookup

```ts
import { __ } from '@rudderjs/localization'

__('messages.welcome', { app: 'RudderJS' }) // 'Welcome to RudderJS!'
__('messages.items', 3) // '3 items'
```

Returns the key if not found.

### trans() - async, loads namespace on first access

```ts
import { trans } from '@rudderjs/localization'

await trans('messages.greeting', { name: 'Alice' }) // 'Hello, Alice!'
await trans('messages.items', 0) // 'no items'
```

> **Vike / SSR note:** Always use `trans()` (not `__()`) in Vike `+data.ts` files. The registry config and translation cache are stored on `globalThis` so they survive Vike's SSR module isolation. `__()` is safe inside middleware and request handlers that run after the namespace is already loaded.

## Pluralization

Laravel-style rules:

```json
{ "apples": "{0} no apples|{1} one apple|{n} :count apples" }
```

```ts
await trans('messages.apples', 0) // 'no apples'
await trans('messages.apples', 1) // 'one apple'
await trans('messages.apples', 7) // '7 apples'
```

Simple two-part rule:

```json
{ "item": "one item|many items" }
```

```ts
await trans('messages.item', 1) // 'one item'
await trans('messages.item', 2) // 'many items'
```

## Locale helpers

```ts
import { getLocale, setLocale, runWithLocale, LocalizationMiddleware } from '@rudderjs/localization'

const current = getLocale()

await runWithLocale('es', async () => {
  setLocale('es')
  return trans('messages.welcome')
})

const mw = LocalizationMiddleware()
```

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
__('messages.nav.home')
__('messages.nav.profile')
```

## Fallback locale

If a key is missing in the current locale, RudderJS automatically checks the configured fallback locale.
