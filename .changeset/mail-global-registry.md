---
'@rudderjs/mail': patch
---

Route `MailRegistry`'s adapter + default-from state through `globalThis` so the registry survives the case where `@rudderjs/mail` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/mail` inline (`Mail.to(...).send()` reads `MailRegistry`), but `MailProvider.boot()` and driver packages (`nodemailer`-backed adapters and future SMTP/SES drivers) are externalized via the provider auto-discovery manifest. Without a shared store, `set()` from the externalized copy would land on a different class than the one `Mail.*` reads from inside the bundle, producing a misleading `[RudderJS Mail] No mail adapter registered` error on every send in prod.

No public API change — same `set` / `get` / `setFrom` / `getFrom` / `reset` surface. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), PR #500 (`@rudderjs/pennant`), PR #501 (`@rudderjs/cache`), and PR #502 (`@rudderjs/queue`).
