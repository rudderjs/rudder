---
"@rudderjs/view": patch
---

Documents the new `export const prerender = true` opt-in in the README — static build-time prerender for views with no per-request data. The flag lives in the view file; the scanner in `@rudderjs/vite` picks it up. No runtime change in `@rudderjs/view` itself.
