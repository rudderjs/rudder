---
"create-rudder-app": minor
"@rudderjs/broadcast": patch
---

feat: per-package demos for cache, queue, mail, notifications, localization, http (Phase 5)

The "Select demos" prompt grows from 8 → 14 entries. Each new demo is a
single view + one API endpoint, gated on the relevant package — same
pattern as the Fibonacci/SystemInfo/Avatar entries from Phase 4.

| Demo | Gate | What it shows |
|------|------|---------------|
| Cache counter | always (Tier A) | `Cache.get` + `Cache.set` round-trip with no TTL; default in-memory driver |
| Queue dispatch | `queue` | Button → `ExampleJob.dispatch().send()` → handler logs to terminal |
| Mail send | `mail` | `Mail.to(addr).send(new DemoMail(subject))` — log driver writes to terminal |
| Notifications | `notifications` + `mail` | `notify(Notification.route('mail', addr), new WelcomeNotification())` — on-demand notifiable, no DB row required |
| Localization | `localization` | Locale switcher hits `/api/i18n?locale=…`; route uses `runWithLocale` + `setLocale` + `trans()`; ships `lang/{en,es,ar}/messages.json` |
| HTTP client | `http` | Server-side `Http.get(url).retry(3, 200).timeout(5000)` against jsonplaceholder + httpstat.us; the 500 endpoint exercises retry |

Net-new scaffolded files when each demo is selected:

- `app/Views/Demos/Cache.tsx`, `Queue.tsx`, `Mail.tsx`, `Notifications.tsx`, `Localization.tsx`, `Http.tsx`
- `app/Jobs/ExampleJob.ts` (queue)
- `app/Mail/DemoMail.ts` (mail)
- `app/Notifications/WelcomeNotification.ts` (notifications)
- `lang/{en,es,ar}/messages.json` (localization)

Smoke profile `--profile=demos-all` now exercises all 12 demos at once
(Phase-4 ports + Phase-5 per-package). 64 files written, full bootApp()
green via `rudder command:list`.

**Bundled renames (cleanup):**

- **`live` demo → `sync` demo** in the scaffolder. The Yjs collaboration
  demo kept the old `'live'` ID across the registry, view file
  (`Live.tsx` → `Sync.tsx`), URL (`/demos/live` → `/demos/sync`), view
  template name (`demos.live` → `demos.sync`), package-json gating, and
  snapshot baseline. The package was renamed `@rudderjs/live` →
  `@rudderjs/sync` back in 2026-04-27, but the demo identifier was
  never updated. Now consistent: package, demo ID, file name, and URL
  all use `sync`.

- **`BKSocket` → `RudderSocket`** in `@rudderjs/broadcast/client/`,
  the playground (`playground/src/RudderSocket.ts`), and the scaffolder
  template (`create-rudder-app/src/templates/demos/rudder-socket.ts`).
  The class name was a leftover from when the framework was called
  "Boost Kit"; nothing else still uses that prefix. The file lives in
  `client/` (vendored template, not exported via `package.json` exports
  map) so this is not an API break for any consumer importing the
  package — but the file path inside the published tarball changes,
  hence the patch bump on `@rudderjs/broadcast`.

Test count: 162 → 169 (+7 new demo gating tests). Snapshot baseline
recaptured: 64 files, 65267 bytes (was 65227 — 40-byte delta from the
RudderSocket symbol rename).
