# Plan: Hybrid Localization for @rudderjs/panels

**Status:** **DONE 2026-04-09.** Phases 1–4 complete. Phase 5 (HMR) deferred indefinitely as nice-to-have. Tasks A (namespace rename), B (typed `LocalizationRegistry` cache access), and C (documentation polish) all landed in a single session after the audit revealed Phases 1–3 had already been silently shipped under the original `panels` namespace.

**Lands in:** `rudderjs/rudder` (`@rudderjs/panels` + `@rudderjs/localization`) BEFORE the Pilotiq extraction.

---

## Current State Audit (2026-04-09)

### What's already shipped ✅

| Phase | What | Where | Status |
|---|---|---|---|
| 1 | `getPanelI18n()` with cache + deepMerge + override | `packages/panels/src/i18n/index.ts` | ✅ DONE |
| 1 | `_clearI18nCache()` for tests/HMR | `packages/panels/src/i18n/index.ts:87` | ✅ DONE |
| 1 | Override merge + fallback chain tests (9 cases) | `packages/panels/src/__tests__/i18n-override.test.ts` | ✅ DONE |
| 1 | **Client-side flow** — `Panel.toMeta()` and `Panel.toNavigationMeta()` embed `getPanelI18n(locale)` directly in the meta payload | `packages/panels/src/Panel.ts:410,428` | ✅ DONE — exactly what the review flagged as a risk is already correct |
| 2 | `preloadPanelTranslations()` at boot, calls `loc.preloadNamespace(locale, 'panels')` for active + fallback | `packages/panels/src/PanelServiceProvider.ts:25-42` | ✅ DONE |
| 2 | Graceful degradation if `@rudderjs/localization` not installed | same file, `try/catch` | ✅ DONE |
| 2 | `_clearI18nCache()` invoked after pre-load (drops any merged result computed before override landed) | `PanelServiceProvider.ts:38` | ✅ DONE |
| 3 | `lang/en/panels.json` starter file (`{}`) | `packages/panels/lang/en/panels.json` | ✅ DONE |
| 3 | `vendor:publish --tag=panels-translations` wired | `PanelServiceProvider.ts:73-76` | ✅ DONE |

### What's NOT shipped ❌

| Item | Why it matters |
|---|---|
| Namespace renamed `panels` → `pilotiq` | Forward compat for the Pilotiq rename. Avoids a breaking migration of `lang/<locale>/panels.json` → `lang/<locale>/pilotiq.json` for early users one release later. |
| Typed `getNamespaceCache()` export from `@rudderjs/localization` | Read path in `getOverride()` currently uses `globalThis['__rudderjs_localization_cache__']` (`i18n/index.ts:42`). Fragile string-keyed global. Symmetric with the existing `preloadNamespace` export. |
| Documentation (user guide + README) | Status unverified. Likely missing or stub. |
| Phase 5 HMR | Optional, deferred. |

### Conclusion

The plan was written before the work was done. **Reframing**: the remaining work is a 1-hour polish pass, not a half-day implementation. Sections below have been demoted accordingly.

---

## Remaining Work (post-audit)

### A. Rename namespace `panels` → `pilotiq`

**Files to change (4 occurrences across 5 files):**

1. `packages/panels/src/i18n/index.ts:45` — change `cache.get(\`${locale}:panels\`)` → `cache.get(\`${locale}:pilotiq\`)`. Also update the doc comment on lines 37–38.
2. `packages/panels/src/PanelServiceProvider.ts:33-35` — change `loc.preloadNamespace(locale, 'panels')` and the fallback call to use `'pilotiq'`. Update the doc comment on lines 21–23 and 86–89.
3. `packages/panels/src/PanelServiceProvider.ts:75` — change `tag: 'panels-translations'` → `tag: 'pilotiq-translations'`. Update the comment on lines 69–72.
4. `packages/panels/lang/en/panels.json` → `packages/panels/lang/en/pilotiq.json` (file rename, content stays `{}`)
5. `packages/panels/src/__tests__/i18n-override.test.ts:19,25` — update the seed function to use `${locale}:pilotiq` and the cleanup loop to match `:pilotiq`.

**Acceptance:**
- All tests still pass (`pnpm test` from `packages/panels`)
- `pnpm rudder vendor:publish --tag=pilotiq-translations` from `playground/` creates `lang/en/pilotiq.json`
- Verified end-to-end: edit `playground/lang/en/pilotiq.json` to override `signOut: 'Logout'`, restart playground, see "Logout" in the panel UI

### B. Add typed `getNamespaceCache()` to `@rudderjs/localization`

**Files to change:**

1. `packages/localization/src/index.ts` — add export:
   ```ts
   export function getNamespaceCache<T = unknown>(
     locale: string,
     namespace: string,
   ): T | undefined {
     return cache.get(`${locale}:${namespace}`) as T | undefined
   }
   ```
   (Concrete implementation depends on the package's actual cache shape — verify before adding.)
2. `packages/panels/src/i18n/index.ts` — refactor `getOverride()` to use the typed export with a guarded dynamic import (since `@rudderjs/localization` is an optional peer dep):
   ```ts
   function getOverride(locale: string): Partial<PanelI18n> | undefined {
     try {
       // eslint-disable-next-line @typescript-eslint/no-require-imports
       const { getNamespaceCache } = require('@rudderjs/localization') as {
         getNamespaceCache?: <T>(locale: string, namespace: string) => T | undefined
       }
       if (!getNamespaceCache) return undefined
       const data = getNamespaceCache<Partial<PanelI18n>>(locale, 'pilotiq')
       if (!data || Object.keys(data).length === 0) return undefined
       return data
     } catch {
       return undefined
     }
   }
   ```
3. Tests still pass — the existing `i18n-override.test.ts` seeds the global Map directly, which the typed export reads from, so test setup needs zero changes.

**Acceptance:**
- `getOverride()` no longer references `globalThis['__rudderjs_localization_cache__']`
- All existing override tests still pass

### C. Documentation

**Files:**

1. `docs/guide/pilotiq-localization.md` (new, VitePress) — explain the override pattern, fallback chain, how to add a new locale, how to override a single string
2. `packages/panels/README.md` — add a section on the override mechanism with a 5-line example
3. `docs/claude/panels.md` — note about the override mechanism for AI context

**Acceptance:**
- README has a working override example
- VitePress guide builds without warnings

### D. Phase 5 HMR (still deferred — skip unless cheap)

Same as before — nice to have, not blocking. Watch `lang/**/pilotiq.json` in dev, invalidate caches, send HMR signal.

---

## Total remaining effort

| Task | LOC | Effort |
|---|---|---|
| A. Namespace rename | ~10 LOC + 1 file move | 15 min |
| B. Typed `getNamespaceCache` + refactor `getOverride` | ~20 LOC | 20 min |
| C. Documentation | ~150 lines of prose | 1 hour |
| D. HMR (optional, deferred) | ~40 LOC | 2 hours |

**Total**: ~30 LOC + 150 lines of docs. **About 1.5 hours of focused work**, not half a day.

---

## Original plan (preserved below for reference)

The sections below describe the work as originally drafted, before the audit revealed how much was already shipped. They are kept for historical context and as a reference for the design decisions (cache shape, fallback chain, namespace convention) that informed the existing implementation. **Do not implement from these sections — use the "Remaining Work" section above.**

---

## Context

`@rudderjs/panels` currently has its own bundled translation files (`packages/panels/src/i18n/en.ts`, `ar.ts`) for UI strings (Sign Out, Search, New, Save, etc.). These are completely separate from `@rudderjs/localization` which loads JSON files from the app's `lang/` directory at runtime.

The two systems share only the **locale value** via `globalThis['__rudderjs_localization_config__']` — `getActiveLocale()` reads it.

**This works well today but has one missing capability:** users cannot add a new locale (e.g. Spanish, French) or override an existing string without forking the panels package.

This plan adds Laravel Filament-style override support while keeping the zero-config bundled defaults.

---

## Goals

1. **Keep zero-config UX** — install panels, get translated UI immediately. No publishing step required.
2. **Allow adding new locales** — users can ship `lang/es/pilotiq.json`, `lang/fr/pilotiq.json` without forking the package
3. **Allow overriding individual strings** — change "Sign Out" to "Logout" without copying the entire i18n file
4. **Type safety preserved** — bundled `en.ts`/`ar.ts` defaults stay as the canonical schema
5. **Backward compatible** — apps that don't add `lang/*/pilotiq.json` continue working unchanged

---

## Non-Goals

- **Not** removing the bundled `en.ts`/`ar.ts` defaults (those are the type-safe canonical schema)
- **Not** unifying everything into JSON-only files (loses type safety, breaks zero-config)
- **Not** adding async translation loading to the panels render path (sync-only via `__()` cache)

---

## Architecture

### Concept: Vendor Namespaces

Laravel Filament uses translation keys like `filament-pilotiq::layout.actions.logout`. The `filament-pilotiq::` prefix is a "vendor namespace" — `__()` resolves it by looking in `lang/<locale>/vendor/filament-panels/layout.php` first, then falling back to the package's bundled translations.

For RudderJS, we'll use `pilotiq::` as the namespace prefix:
- `pilotiq::sidebar.signOut` → look for override in `lang/<locale>/pilotiq.json` first, fall back to bundled `en.ts`/`ar.ts`
- `pilotiq::dataTable.empty` → same pattern

### Override File Format

Users can override panel strings by creating JSON files in `lang/<locale>/pilotiq.json`:

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

A locale that doesn't exist in bundled translations (e.g. Spanish) can be created entirely from `lang/es/pilotiq.json`:

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

The fallback chain: `pilotiq.json[es]` → `pilotiq.json[en]` (fallback locale) → `bundled.en` → key as string.

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
  // Prefer the typed `getNamespaceCache()` export from `@rudderjs/localization`
  // (added in Phase 2 alongside `preloadNamespace`). Fall back to a no-op if
  // localization isn't installed — panels keeps working with bundled defaults.
  try {
    // Sync require — localization is an optional peer dep, so guard it.
    // Both packages currently live in the same monorepo so this resolves cleanly.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getNamespaceCache } = require('@rudderjs/localization') as {
      getNamespaceCache?: (locale: string, namespace: string) => unknown
    }
    if (!getNamespaceCache) return undefined
    return getNamespaceCache(locale, 'pilotiq') as Partial<PanelI18n> | undefined
  } catch {
    return undefined
  }
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

The override file (`lang/<locale>/pilotiq.json`) needs to be loaded into the localization cache before any panel renders. Two options:

**Option A: Lazy-load via `getOverride()`**
- Don't pre-load. The first call to `getPanelI18n()` checks the cache.
- Problem: Cache is populated by `loadNamespace()` in `@rudderjs/localization` which is async. Sync `getPanelI18n()` can't trigger an async load.

**Option B: Eager pre-load during panel boot**
- Add a `preloadPanelTranslations()` function to `@rudderjs/panels` that the panel service provider calls during boot.
- It calls `loadNamespace(locale, 'pilotiq')` and `loadNamespace(fallback, 'pilotiq')` from `@rudderjs/localization`.
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
    await loadNamespace(config.locale, 'pilotiq')
    if (config.locale !== config.fallback) {
      await loadNamespace(config.fallback, 'pilotiq')
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

/**
 * Read a pre-loaded namespace from the cache.
 * Returns undefined if the namespace hasn't been loaded yet.
 *
 * Symmetric with `preloadNamespace` — packages that pre-load at boot
 * can read back synchronously without reaching into globalThis.
 */
export function getNamespaceCache<T = unknown>(
  locale: string,
  namespace: string,
): T | undefined {
  // Internal: same Map that loadNamespace populates.
  // Concrete implementation depends on the localization package's current
  // cache shape — verify during Phase 2 implementation and adjust if needed.
  return cache.get(`${locale}:${namespace}`) as T | undefined
}
```

`getNamespaceCache` replaces the `globalThis['__rudderjs_localization_cache__']` access shown in §1's `getOverride()` sketch. Same data, typed boundary, no string-keyed global.

Then panels' provider does:
```ts
const { preloadNamespace, LocalizationRegistry } = await import('@rudderjs/localization')
const { locale, fallback } = LocalizationRegistry.getConfig()
await preloadNamespace(locale, 'pilotiq')
if (locale !== fallback) await preloadNamespace(fallback, 'pilotiq')
```

### 4. Override File Template (no schema in v1)

Scaffold a starter override file via the existing vendor:publish command:

```bash
pnpm rudder vendor:publish --tag=pilotiq-translations
```

This scaffolds an empty `lang/en/pilotiq.json`:
```json
{
  "sidebar": {
    "signOut": "Logout"
  }
}
```

**No `$schema` reference in v1.** JSON Schema generation is deferred (Open Question #5) — including a `$schema` pointing at a non-existent file would trip IDE warnings. Users get autocomplete *if* they look at the bundled `en.ts` for the canonical key shape. Schema generation lands as a follow-up plan if there's demand.

### 5. HMR Support

When `lang/<locale>/pilotiq.json` is edited in dev mode, the override should hot-reload. Two pieces:

1. **Localization package** — already has cache invalidation via `LocalizationRegistry.reset()`. Need a way to invalidate just one namespace.
2. **Panels i18n cache** — need to call `_clearI18nCache()` when overrides change.

Add a Vite plugin hook in `@rudderjs/vite` or `@rudderjs/panels`:
```ts
// Watch lang/**/pilotiq.json and invalidate caches on change
configureServer(server) {
  server.watcher.on('change', (file) => {
    if (file.endsWith('/pilotiq.json')) {
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
- `packages/panels/src/__tests__/i18n.test.ts` — extend with override merge + fallback chain tests

**Acceptance:**
- `getPanelI18n('ar')` returns merged result if `lang/ar/pilotiq.json` is in the localization cache
- Returns bundled defaults if no override exists
- Cache prevents re-merging on every call
- **Browser receives merged (override + bundled) strings via panel meta payload.** Verify by editing `lang/en/pilotiq.json` in the playground, restarting, and inspecting the rendered panel UI in the browser — the override must take effect client-side, not just server-side. If translations don't currently flow through `Panel.toMeta()` / `Panel.toNavigationMeta()`, that's a blocking sub-task before Phase 1 ships (cross-ref `feedback_panel_navigation_vs_full_meta.md`).
- Tests cover: deep merge edge cases, fallback chain (`es → en → bundled.en → key-as-string`), graceful degradation when `@rudderjs/localization` is not installed (panels works with bundled defaults only)

### Phase 2: Pre-load at Panel Boot

**Pre-flight (do first, ~30 seconds):**
- Grep for the actual panels boot/service-provider entry point. Plan originally referenced `packages/panels/src/provider.ts` but that file may not exist as named — the boot logic may live in `Global.ts`, a registry, or a service provider file under a different name. Update this plan with the real path before adding the `preloadNamespace` call.

**Files:**
- `packages/localization/src/index.ts` — export `preloadNamespace()` AND `getNamespaceCache()` (the symmetric read accessor used by panels' `getOverride()`)
- `packages/panels/src/<actual-boot-file>.ts` — call `preloadNamespace('pilotiq')` during boot for both active locale and fallback
- `packages/panels/src/i18n/index.ts` — replace the `globalThis` cache access in `getOverride()` with `getNamespaceCache()`

**Acceptance:**
- After panel boots, `getPanelI18n(locale)` finds the override sync from cache
- If `@rudderjs/localization` not installed, panels still works with bundled defaults

### Phase 3: Vendor Publish Command

**Files:**
- `packages/cli/src/commands/vendor-publish.ts` — extend or add `--tag=pilotiq-translations`
- `packages/panels/lang/template.json` — empty starter file (no `$schema` reference in v1)

**Acceptance:**
- `pnpm rudder vendor:publish --tag=pilotiq-translations` creates `lang/en/pilotiq.json`
- The created file is a plain JSON object with example keys; no `$schema` reference (deferred until schema generation lands)

### Phase 4: Documentation

**Files:**
- `docs/guide/panels-localization.md` (VitePress) — explains override pattern + example
- Update `packages/panels/README.md` — mention `pilotiq::` namespace and override file location
- Update `docs/claude/panels.md` — note about override mechanism for the AI

### Phase 5 (Optional): HMR Support

**Files:**
- `packages/vite/src/index.ts` — watch `lang/**/pilotiq.json` and invalidate caches on change

**Acceptance:**
- Edit `lang/ar/pilotiq.json` in dev mode — panel UI updates without restart

### Deferred to follow-up plans (NOT in v1)

- **Per-extension namespaces actually implemented.** This plan establishes the convention (Open Q #3) but only ships the `pilotiq` namespace for `@rudderjs/panels` itself. `@rudderjs/panels-lexical` (toolbar buttons, link dialog strings, etc.) keeps its bundled-only translations until a follow-up applies the same pattern under namespace `pilotiq-lexical`.
- **Pro package translations.** `@pilotiq-pro/ai` (chat UI strings, system messages) and `@pilotiq-pro/collab` (presence labels) will follow the same pattern as separate follow-ups, post-extraction. Namespaces: `pilotiq-ai`, `pilotiq-collab`.
- **JSON Schema generation** from the `PanelI18n` interface for IDE autocomplete (Open Q #5).
- **Pluralization and interpolation** in panel strings (Open Q #4).
- **Per-tenant translation overrides.** This plan's overrides are app-global. Multi-tenant apps that want different translations per tenant are out of scope; the merged cache is keyed by locale only.

---

## Migration Strategy

### For existing apps
**Backward compatible** — apps that don't add `lang/<locale>/pilotiq.json` continue using bundled defaults. Zero changes required.

### For users who want to override
1. Run `pnpm rudder vendor:publish --tag=pilotiq-translations`
2. Edit `lang/<locale>/pilotiq.json` with the keys they want to override
3. Restart dev server (or HMR if Phase 5 implemented)

### For users adding a new locale
1. Create `lang/es/pilotiq.json` (or use the publish command to scaffold)
2. Fill in all keys (no bundled fallback for unsupported locales — but English will be used as last-resort fallback via the existing fallback chain)
3. Set `app.locale = 'es'` in config

---

## Open Questions

### 1. Where do override files live?

**Options:**
- **A. `lang/<locale>/pilotiq.json`** — Laravel-style flat namespace
- **B. `lang/<locale>/vendor/pilotiq.json`** — Laravel Filament style with `vendor/` subfolder
- **C. `lang/vendor/panels/<locale>.json`** — vendor-first structure

**Recommendation:** **A**. Simplest. Matches the existing localization package's expectation that `${locale}:${namespace}` maps to `lang/<locale>/<namespace>.json`. Adding a vendor subfolder would require changing how `loadNamespace()` resolves paths.

### 2. Should the `pilotiq::` prefix be exposed to users?

The internal `getPanelI18n()` doesn't use the prefix — it loads the `panels` namespace directly. The prefix is conceptual.

But if users want to use `trans('pilotiq::sidebar.signOut')` in their own components, the localization package would need to handle the `::` prefix as a namespace override.

**Recommendation:** Don't expose the prefix in v1. Internal panel UI uses `getPanelI18n()` directly. Users who want to reference panel strings in their own code can use `trans('panels.sidebar.signOut')` (no prefix, just the namespace).

### 3. What about extension packages (panels-lexical, media, workspaces)?

Extensions may also have UI strings. Should they share the `pilotiq.json` namespace or use their own?

**Recommendation:** Each extension uses its own namespace:
- `lang/<locale>/pilotiq.json` — core panels
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
| 1. Override support in i18n/index.ts + tests | ~100 | Low |
| 2. Pre-load at panel boot + `getNamespaceCache` export | ~50 | Low (Phase 2 pre-flight: locate the real boot file) |
| 3. Vendor publish command | ~60 | Medium (extends existing command) |
| 4. Documentation | ~150 lines of prose | Low |
| 5. HMR support (optional) | ~40 | Medium |

**Total**: ~250 LOC + ~150 lines of docs. Half a day of focused work for phases 1–4. Add another 2 hours for phase 5.

---

## Acceptance Criteria

- [ ] `lang/en/pilotiq.json` with overrides changes panel UI strings
- [ ] **Override changes are visible in the browser**, not just server-side (translations flow through panel meta payload)
- [ ] `lang/es/pilotiq.json` with full Spanish translations works (new locale not bundled)
- [ ] Missing keys in override fall back to bundled defaults
- [ ] Panels still works with no override files (zero-config preserved)
- [ ] Panels still works with `@rudderjs/localization` not installed (bundled defaults only — verified with a test that mocks the optional peer as missing)
- [ ] `getPanelI18n()` is sync, no async leaks into the render path
- [ ] Cache prevents re-merging on every call
- [ ] `getOverride()` reads via `getNamespaceCache()` from `@rudderjs/localization`, not via direct `globalThis` access
- [ ] `pnpm rudder vendor:publish --tag=pilotiq-translations` scaffolds the override file (no `$schema` reference)
- [ ] Tests cover the merge logic, fallback chain, boot pre-load integration, and the missing-localization-package degradation path
- [ ] README updated with override example
- [ ] `feedback_panels_localization.md` memory note updated to reference the new namespace name (`pilotiq`) and the `getNamespaceCache` export

---

## Files to Create

```
packages/panels/src/__tests__/i18n.test.ts         # extend with override merge + fallback tests (file already exists)
packages/panels/lang/template.json                 # starter override file (no $schema)
docs/guide/panels-localization.md                  # user guide (renamed to pilotiq-localization.md before extraction)
```

## Files to Modify

```
packages/panels/src/i18n/index.ts                  # add getOverride (via getNamespaceCache), deepMerge, cache
packages/panels/src/<actual-boot-file>.ts          # pre-load 'pilotiq' namespace at boot — FILE NAME TBD in Phase 2 pre-flight
packages/localization/src/index.ts                 # export preloadNamespace + getNamespaceCache
packages/cli/src/commands/vendor-publish.ts        # add pilotiq-translations tag
packages/panels/README.md                          # document override pattern
docs/claude/panels.md                              # add override mechanism note (will move to pilotiq-io/pilotiq during extraction)
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
