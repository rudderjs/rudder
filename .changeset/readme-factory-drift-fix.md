---
'@rudderjs/ai': patch
'@rudderjs/auth': patch
'@rudderjs/broadcast': patch
'@rudderjs/cache': patch
'@rudderjs/context': patch
'@rudderjs/core': patch
'@rudderjs/crypt': patch
'@rudderjs/hash': patch
'@rudderjs/localization': patch
'@rudderjs/log': patch
'@rudderjs/mail': patch
'@rudderjs/notification': patch
'@rudderjs/pennant': patch
'@rudderjs/schedule': patch
'@rudderjs/session': patch
'@rudderjs/socialite': patch
---

Fix fictional factory-function references in package READMEs — same drift class PR #233 fixed in `boost/guidelines.md`. Replaces non-existent `pkg(configs.pkg)` factory calls with the actual `*Provider` classes (e.g. `import { CacheProvider } from '@rudderjs/cache'` + `[CacheProvider]`), corrects auth's `authProvider(...)` → `AuthProvider` in setup + prose, fixes core's dynamic-registration example to use the real `CacheProvider` class, and updates ai's setup example to import `AiProvider` from the `/server` subpath. Documentation only; no code changes.
