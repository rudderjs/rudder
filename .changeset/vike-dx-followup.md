---
"@rudderjs/session": minor
"@rudderjs/localization": minor
---

Follow up on #391 — adopt the page-context enhancer pattern in two more packages so views read framework state directly from `pageContext`:

- **`@rudderjs/session`** registers an enhancer that sets `pageContext.flash` to the flash bag from the previous request. New `Session.allFlash()` (static) + `SessionInstance.allFlash()` accessor return a copy of all flash entries; the existing per-key `getFlash(key)` API is unchanged. `Vike.PageContext.flash?: Record<string, unknown>` augmentation auto-applies when both `@rudderjs/session` and `@rudderjs/vite` are installed.
- **`@rudderjs/localization`** registers an enhancer that sets `pageContext.locale` to the active request locale via `getLocale()`. Falls back to the config default outside the ALS context. `Vike.PageContext.locale?: string` augmentation auto-applies similarly.

Both registrations are lazy + try/catch around the optional `@rudderjs/vite` peer — no behavior change for API-only apps that don't install it.

No API breaks. New optional peer: `@rudderjs/vite` on both packages.
