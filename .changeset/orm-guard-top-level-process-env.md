---
"@rudderjs/orm": patch
---

Guard the top-level `process.env` read in the ORM main entry so `@rudderjs/orm` evaluates in browser bundles. Since 1.12.4 the `RUDDER_ORM_TRACE` diagnostic read `process.env` unguarded at module top level, throwing `process is not defined` whenever a `Model` was reachable from a client bundle — which broke SPA navigation in Vike apps (React never hydrated). Now guarded with `typeof process !== 'undefined'` (same for the in-`morphTo` `NODE_ENV` dev-check); server behavior is unchanged.
