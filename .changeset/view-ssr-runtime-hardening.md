---
"@rudderjs/view": minor
---

Harden the controller-view SSR runtime against secret leakage and XSS laundering.

- **`static hidden` is now honored on the `view()` path.** Vike's client-hydration serializer does not call `toJSON()`, so `view('dashboard', { user })` where `user` is an ORM Model serialized EVERY column (including `password` / `rememberToken`) into the browser payload, silently bypassing the Model's `static hidden` allowlist. `view()` now walks props through `toJSON()` before handing them to Vike (new exported `serializeViewProps`), so `hidden`/`visible` are enforced on the SSR path exactly as on the API path. `Date` and `Map`/`Set` (which Vike round-trips specially) are left intact; circular graphs are safe.
- **`SafeString` can no longer be impersonated to launder unescaped markup.** `renderHtmlValue` gated trusted pass-through on `instanceof SafeString`, which a prototype-spoofed object (`Object.create(SafeString.prototype)`) passes. It now uses a private-field brand (`SafeString.isSafe`), so only genuine instances bypass escaping.
- **New `safeUrl()` helper for `href`/`src` interpolation.** `escapeHtml` does not validate URL schemes, so an escaped `javascript:alert(1)` still executes on click. `safeUrl()` neutralizes `javascript:` / `data:` / `vbscript:` URLs (including tab/newline and leading-whitespace evasions) to `'#'`. `escapeHtml`'s docs now also spell out that interpolated attributes must be quoted.
- **View response headers are sanitized before forwarding.** A view-supplied header whose value carries CR/LF/NUL (e.g. a value built from request data) made undici's `Headers` throw deep inside `renderPage()` — a request-triggered 500. Such headers, and headers with invalid names, are now dropped, which also forecloses any response-header-injection vector.
