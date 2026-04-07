# Plan: Hybrid Localization for @rudderjs/panels

## Context

`@rudderjs/panels` currently has its own bundled translation files (`packages/panels/src/i18n/en.ts`, `ar.ts`) for UI strings (Sign Out, Search, New, Save, etc.). These are completely separate from `@rudderjs/localization` which loads JSON files from the app's `lang/` directory at runtime.

The two systems share only the **locale value** via `globalThis['__rudderjs_localization_config__']` — `getActiveLocale()` reads it.

**This works well today but has one missing capability:** users cannot add a new locale (e.g. Spanish, French) or override an existing string without forking the panels package.

This plan adds Laravel Filament-style override support while keeping the zero-config bundled defaults.

---

## Goals

1. **Keep zero-config UX** — install panels, get translated UI immediately. No publishing step required.
2. **Allow adding new locales** — users can ship `lang/es/panels.json`, `lang/fr/panels.json` without forking the package
3. **Allow overriding individual strings** — change "Sign Out" to "Logout" without copying the entire i18n file
4. **Type safety preserved** — bundled `en.ts`/`ar.ts` defaults stay as the canonical schema
5. **Backward compatible** — apps that don't add `lang/*/panels.json` continue working unchanged

---

## Non-Goals

- **Not** removing the bundled `en.ts`/`ar.ts` defaults (those are the type-safe canonical schema)
- **Not** unifying everything into JSON-only files (loses type safety, breaks zero-config)
- **Not** adding async translation loading to the panels render path (sync-only via `__()` cache)

---

## Architecture

### Concept: Vendor Namespaces

Laravel Filament uses translation keys like `filament-panels::layout.actions.logout`. The `filament-panels::` prefix is a "vendor namespace" — `__()` resolves it by looking in `lang/<locale>/vendor/filament-panels/layout.php` first, then falling back to the package's bundled translations.

For RudderJS, we'll use `panels::` as the namespace prefix:
- `panels::sidebar.signOut` → look for override in `lang/<locale>/panels.json` first, fall back to bundled `en.ts`/`ar.ts`
- `panels::dataTable.empty` → same pattern

### Override File Format

Users can override panel strings by creating JSON files in `lang/<locale>/panels.json`:

```json
{
  "sidebar": {
    "signOut": "Logout",
    "settings": "Preferences"
  },
  "dataTable": {
    "empty": "No records to display"
  }
}
```

Only keys present in the override file are used; missing keys fall through to the bundled defaults.

### Locale Coverage

A locale that doesn't exist in bundled translations (e.g. Spanish) can be created entirely from `lang/es/panels.json`:

```json
{
  "sidebar": {
    "signOut": "Cerrar sesión",
    "settings": "Configuración",
    ...
  },
  ...
}
```

The fallback chain: `panels.json[es]` → `panels.json[en]` (fallback locale) → `bundled.en` → key as string.

---

## Implementation

### 1. Update `getPanelI18n()` in `packages/panels/src/i18n/index.ts`

Currently:
```ts
export function getPanelI18n(locale: string): PanelI18n {
  const base = locale.split('-')[0] ?? locale
  return translations[locale] ?? translations[base] ?? en
}
```

New version (sync, cached, with override support):
```ts
import { en } from './en.js'
import { ar } from './ar.js'
import type { PanelI18n } from './en.js'

export type { PanelI18n }

const translations: Record<string, PanelI18n> = { en, ar }
const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug'])

// Cache merged i18n per locale to avoid re-merging on every call
const mergedCache = new Map<string, PanelI18n>()

export function getPanelI18n(locale: string): PanelI18n {
  // Return cached merged result if available
  const cached = mergedCache.get(locale)
  if (cached) return cached

  const base = locale.split('-')[0] ?? locale

  // 1. Start with bundled default for this locale (or en fallback)
  const bundled = translations[locale] ?? translations[base] ?? en

  // 2. Try to load app override from @rudderjs/localization cache
  const override = getOverride(locale) ?? getOverride(base)

  // 3. Deep merge: override values win, bundled fills gaps
  const merged = override ? deepMerge(bundled, override) as PanelI18n : bundled

  mergedCache.set(locale, merged)
  return merged
}

/**
 * Read panel translations from @rudderjs/localization's cache.
 * Returns undefined if no override exists or localization isn't installed.
 */
function getOverride(locale: string): Partial<PanelI18n> | undefined {
  const g = globalThis as Record<string, unknown>
  const cache = g['__rudderjs_localization_cache__'] as Map<string, unknown> | undefined
  if (!cache) return undefined

  // Localization stores by `${locale}:${namespace}` — namespace is the JSON file name
  const data = cache.get(`${locale}:panels`) as Partial<PanelI18n> | undefined
  return data
}

function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target } as Record<string, unknown>
  for (const [key, value] of Object.entries(source)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof result[key] === 'object' &&
      result[key] !== null
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>)
    } else if (value !== undefined) {
      result[key] = value
    }
  }
  return result as T
}

export function getPanelDir(locale: string): 'ltr' | 'rtl' {
  const base = locale.split('-')[0] ?? locale
  return RTL_LOCALES.has(base) ? 'rtl' : 'ltr'
}

export function getActiveLocale(): string {
  const g = globalThis as Record<string, unknown>
  const config = g['__rudderjs_localization_config__'] as { locale?: string } | undefined
  return config?.locale ?? 'en'
}

/** @internal — clears the merged cache. Used by HMR and tests. */
export function _clearI18nCache(): void {
  mergedCache.clear()
}
```

### 2. Pre-load `panels` namespace at panel boot

The override file (`lang/<locale>/panels.json`) needs to be loaded into the localization cache before any panel renders. Two options:

**Option A: Lazy-load via `getOverride()`**
- Don't pre-load. The first call to `getPanelI18n()` checks the cache.
- Problem: Cache is populated by `loadNamespace()` in `@rudderjs/localization` which is async. Sync `getPanelI18n()` can't trigger an async load.

**Option B: Eager pre-load during panel boot**
- Add a `preloadPanelTranslations()` function to `@rudderjs/panels` that the panel service provider calls during boot.
- It calls `loadNamespace(locale, 'panels')` and `loadNamespace(fallback, 'panels')` from `@rudderjs/localization`.
- Once loaded, `getPanelI18n()` finds it sync from the cache.

**Recommendation: Option B.** Add to panels service provider boot:

```ts
// packages/panels/src/provider.ts (or wherever panels boots)
async boot(): Promise<void> {
  // ...existing boot logic
  
  // Preload panel translation overrides if @rudderjs/localization is installed
  try {
    const { LocalizationRegistry } = await import('@rudderjs/localization')
    const config = LocalizationRegistry.getConfig()
    const { loadNamespace } = await import('@rudderjs/localization/internal') // export needed
    await loadNamespace(config.locale, 'panels')
    if (config.locale !== config.fallback) {
      await loadNamespace(config.fallback, 'panels')
    }
  } catch {
    // @rudderjs/localization not installed — use bundled defaults only
  }
}
```

### 3. Export `loadNamespace` from `@rudderjs/localization`

`loadNamespace()` is currently a private function in `packages/localization/src/index.ts`. Need to export it (or a public wrapper) so panels can pre-load the namespace.

Add to `packages/localization/src/index.ts`:
```ts
/**
 * Pre-load a translation namespace into the cache.
 * Useful for packages that need their translations available synchronously.
 */
export async function preloadNamespace(locale: string, namespace: string): Promise<void> {
  await loadNamespace(locale, namespace)
}
```

Then panels' provider does:
```ts
const { preloadNamespace, LocalizationRegistry } = await import('@rudderjs/localization')
const { locale, fallback } = LocalizationRegistry.getConfig()
await preloadNamespace(locale, 'panels')
if (locale !== fallback) await preloadNamespace(fallback, 'panels')
```

### 4. Type Definitions for Override Files

Generate a JSON Schema from `PanelI18n` so users get autocomplete in their `panels.json`:

```bash
pnpm rudder vendor:publish --tag=panels-translations
```

This command (via `make:translations` or similar) scaffolds:
- `lang/en/panels.json` (empty `{}` with `$schema` reference)
- A JSON schema at `node_modules/@rudderjs/panels/schema/panels-i18n.schema.json` generated from the `PanelI18n` TypeScript interface

User's `panels.json` references the schema for IDE autocomplete:
```json
{
  "$schema": "../../node_modules/@rudderjs/panels/schema/panels-i18n.schema.json",
  "sidebar": {
    "signOut": "Logout"
  }
}
```

### 5. HMR Support

When `lang/<locale>/panels.json` is edited in dev mode, the override should hot-reload. Two pieces:

1. **Localization package** — already has cache invalidation via `LocalizationRegistry.reset()`. Need a way to invalidate just one namespace.
2. **Panels i18n cache** — need to call `_clearI18nCache()` when overrides change.

Add a Vite plugin hook in `@rudderjs/vite` or `@rudderjs/panels`:
```ts
// Watch lang/**/panels.json and invalidate caches on change
configureServer(server) {
  server.watcher.on('change', (file) => {
    if (file.endsWith('/panels.json')) {
      // Clear localization cache for the namespace
      // Clear panels merged cache
      // Send HMR signal to client to refetch panel meta
    }
  })
}
```

This is nice-to-have, not required for v1.

---

## Implementation Phases

### Phase 1: Core Override Support

**Files:**
- `packages/panels/src/i18n/index.ts` — add `getOverride()`, deep merge, cache
- `packages/panels/src/__tests__/i18n.test.ts` — test override + fallback chain

**Acceptance:**
- `getPanelI18n('ar')` returns merged result if `lang/ar/panels.json` is in the localization cache
- Returns bundled defaults if no override exists
- Cache prevents re-merging on every call

### Phase 2: Pre-load at Panel Boot

**Files:**
- `packages/localization/src/index.ts` — export `preloadNamespace()`
- `packages/panels/src/provider.ts` (or service provider file) — call `preloadNamespace('panels')` during boot

**Acceptance:**
- After panel boots, `getPanelI18n(locale)` finds the override sync from cache
- If `@rudderjs/localization` not installed, panels still works with bundled defaults

### Phase 3: Vendor Publish Command

**Files:**
- `packages/cli/src/commands/vendor-publish.ts` — extend or add `--tag=panels-translations`
- `packages/panels/lang/template.json` — empty starter file with `$schema` reference
- `packages/panels/schema/panels-i18n.schema.json` — auto-generated from PanelI18n type

**Acceptance:**
- `pnpm rudder vendor:publish --tag=panels-translations` creates `lang/en/panels.json`
- The created file has `$schema` reference for IDE autocomplete

### Phase 4: Documentation

**Files:**
- `docs/guide/panels-localization.md` (VitePress) — explains override pattern + example
- Update `packages/panels/README.md` — mention `panels::` namespace and override file location
- Update `docs/claude/panels.md` — note about override mechanism for the AI

### Phase 5 (Optional): HMR Support

**Files:**
- `packages/vite/src/index.ts` — watch `lang/**/panels.json` and invalidate caches on change

**Acceptance:**
- Edit `lang/ar/panels.json` in dev mode — panel UI updates without restart

---

## Migration Strategy

### For existing apps
**Backward compatible** — apps that don't add `lang/<locale>/panels.json` continue using bundled defaults. Zero changes required.

### For users who want to override
1. Run `pnpm rudder vendor:publish --tag=panels-translations`
2. Edit `lang/<locale>/panels.json` with the keys they want to override
3. Restart dev server (or HMR if Phase 5 implemented)

### For users adding a new locale
1. Create `lang/es/panels.json` (or use the publish command to scaffold)
2. Fill in all keys (no bundled fallback for unsupported locales — but English will be used as last-resort fallback via the existing fallback chain)
3. Set `app.locale = 'es'` in config

---

## Open Questions

### 1. Where do override files live?

**Options:**
- **A. `lang/<locale>/panels.json`** — Laravel-style flat namespace
- **B. `lang/<locale>/vendor/panels.json`** — Laravel Filament style with `vendor/` subfolder
- **C. `lang/vendor/panels/<locale>.json`** — vendor-first structure

**Recommendation:** **A**. Simplest. Matches the existing localization package's expectation that `${locale}:${namespace}` maps to `lang/<locale>/<namespace>.json`. Adding a vendor subfolder would require changing how `loadNamespace()` resolves paths.

### 2. Should the `panels::` prefix be exposed to users?

The internal `getPanelI18n()` doesn't use the prefix — it loads the `panels` namespace directly. The prefix is conceptual.

But if users want to use `trans('panels::sidebar.signOut')` in their own components, the localization package would need to handle the `::` prefix as a namespace override.

**Recommendation:** Don't expose the prefix in v1. Internal panel UI uses `getPanelI18n()` directly. Users who want to reference panel strings in their own code can use `trans('panels.sidebar.signOut')` (no prefix, just the namespace).

### 3. What about extension packages (panels-lexical, media, workspaces)?

Extensions may also have UI strings. Should they share the `panels.json` namespace or use their own?

**Recommendation:** Each extension uses its own namespace:
- `lang/<locale>/panels.json` — core panels
- `lang/<locale>/panels-lexical.json` — lexical editor strings
- `lang/<locale>/media.json` — media library strings
- `lang/<locale>/workspaces.json` — workspaces strings

Each extension package follows the same pattern (bundled defaults + optional override).

### 4. Pluralization and interpolation

Localization package supports `:name` interpolation and `{1} cat|{n} cats` pluralization. Panels' bundled `en.ts` doesn't use these (just plain strings). Should overrides support them?

**Recommendation:** Overrides are plain strings for v1. If a user needs interpolation in a panel string, they can do it in the override and the bundled key needs to support it too. Defer until needed.

### 5. JSON Schema generation

Auto-generating a JSON schema from the `PanelI18n` TypeScript interface requires `ts-json-schema-generator` or similar. Adds a build dependency.

**Recommendation:** Skip schema generation in v1. Users get a starter file via `vendor:publish` and can read the bundled `en.ts` for reference. Add schema generation as a follow-up if there's demand.

---

## Effort Estimate

| Phase | LOC | Complexity |
|---|---|---|
| 1. Override support in i18n/index.ts | ~80 | Low |
| 2. Pre-load at panel boot | ~30 | Low (need to find panels' boot file) |
| 3. Vendor publish command | ~60 | Medium (extends existing command) |
| 4. Documentation | ~150 lines of prose | Low |
| 5. HMR support (optional) | ~40 | Medium |

**Total**: ~210 LOC + ~150 lines of docs. Half a day of focused work for phases 1-4. Add another 2 hours for phase 5.

---

## Acceptance Criteria

- [ ] `lang/en/panels.json` with overrides changes panel UI strings
- [ ] `lang/es/panels.json` with full Spanish translations works (new locale not bundled)
- [ ] Missing keys in override fall back to bundled defaults
- [ ] Panels still works with no override files (zero-config preserved)
- [ ] Panels still works with `@rudderjs/localization` not installed (bundled defaults only)
- [ ] `getPanelI18n()` is sync, no async leaks into the render path
- [ ] Cache prevents re-merging on every call
- [ ] `pnpm rudder vendor:publish --tag=panels-translations` scaffolds the override file
- [ ] Tests cover the merge + fallback chain
- [ ] README updated with override example

---

## Files to Create

```
packages/panels/__tests__/i18n-override.test.ts    # tests for override merge logic
packages/panels/lang/template.json                 # starter file for vendor:publish
docs/guide/panels-localization.md                  # user guide
```

## Files to Modify

```
packages/panels/src/i18n/index.ts                  # add getOverride, deepMerge, cache
packages/panels/src/provider.ts                    # pre-load panels namespace at boot
packages/localization/src/index.ts                 # export preloadNamespace
packages/cli/src/commands/vendor-publish.ts        # add panels-translations tag
packages/panels/README.md                          # document override pattern
docs/claude/panels.md                              # add override mechanism note
```

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Sync `getPanelI18n()` can't load files → first call returns bundled defaults | Pre-load at boot via `preloadNamespace()` ensures cache is hot before first render |
| Cache stale after override file edited | Phase 5 HMR hooks (or restart dev server) |
| Deep merge edge cases (arrays, null) | Comprehensive test suite for merge logic |
| User overrides break type contract | Schema generation (deferred) or runtime validation |
| Confuses users about which translations to edit | Clear documentation about bundled vs override |

---

## Future Enhancements (Not in This Plan)

- **Pluralization in panel strings** — when needed by a real use case
- **JSON schema generation** from `PanelI18n` interface for IDE autocomplete
- **Translation management UI** inside the panel itself — edit translations live
- **Translation contribution workflow** — users PR new bundled locales upstream to the package
- **AI-assisted translation** — `@rudderjs/ai` integration to auto-translate missing keys
