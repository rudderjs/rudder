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

## Pre-loading namespaces

Some packages need a namespace available **synchronously** (e.g. `@rudderjs/panels` resolves UI strings during render). Use `preloadNamespace()` from a service provider's `boot()` to warm the cache:

```ts
import { preloadNamespace, LocalizationRegistry } from '@rudderjs/localization'

const { locale, fallback } = LocalizationRegistry.getConfig()
await preloadNamespace(locale, 'pilotiq')
if (fallback !== locale) await preloadNamespace(fallback, 'pilotiq')
```

After this runs, `__('pilotiq.signOut')` resolves without an `await`.

## Typed cache access

Packages that bundle their own translations and need a sync, typed read path can use `LocalizationRegistry`'s static methods directly. Useful when implementing a sync resolver (e.g. `getPanelI18n()`) that can't `await trans()` from a render path:

```ts
import { LocalizationRegistry } from '@rudderjs/localization'

// Read a pre-loaded namespace
const data = LocalizationRegistry.getCached('en', 'pilotiq')
//    ^? Record<string, unknown> | undefined

// Seed the cache (for tests, fixtures, or programmatic translations)
LocalizationRegistry.setCached('en', 'pilotiq', { signOut: 'Logout' })

// Clear a single namespace entry (for test teardown)
LocalizationRegistry.deleteCached('en', 'pilotiq')

// Reset everything (cache + config)
LocalizationRegistry.reset()
```

These methods are the **typed boundary** for any package that needs to read or write the localization cache directly. Prefer them over reaching into `globalThis['__rudderjs_localization_cache__']` — even though both end up at the same Map, the static methods are the public, type-safe contract that won't break if the internal cache shape changes. The reference implementation is `@rudderjs/panels`'s `getOverride()`, which captures the `LocalizationRegistry` reference at boot time and reads through it from sync render paths.

## Overriding bundled translations (vendor namespaces)

Some packages ship their own bundled translations as the canonical schema (e.g. `@rudderjs/panels`). To override individual strings or add a new locale, drop a JSON file at `lang/<locale>/<short-name>.json` (the short name is documented per package — for `@rudderjs/panels` it is `pilotiq`):

```json
// lang/en/pilotiq.json
{
  "signOut": "Logout"
}
```

Only the keys you specify are overridden; missing keys fall back to the bundled defaults. See [`@rudderjs/panels` › Localization](./panels/index.md#localization) for the full pattern, and `docs/contributing/new-package.md` § "Bundled translations & overrides" for the convention all RudderJS packages should follow when shipping UI strings.
