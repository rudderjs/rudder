---
"@rudderjs/vite": minor
---

The typed-`route()` registry moved from `pages/__view/routes.d.ts` to `routes/__registry.d.ts` — domain-adjacent to the route files it types (an API-only app no longer grows a `pages/` directory for it). Migration is automatic: the scanner deletes the legacy file when it writes the new one on your next dev / build / `rudder routes:sync` — commit the move. The scanner also no longer re-scans its own emit, and the dev re-boot watcher ignores the registry write (no chained second re-boot after a route edit).
