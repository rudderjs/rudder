---
"@rudderjs/auth": patch
"@rudderjs/broadcast": patch
"@rudderjs/cashier-paddle": patch
"@rudderjs/notification": patch
"@rudderjs/horizon": patch
"@rudderjs/pulse": patch
"@rudderjs/telescope": patch
---

`vendor:publish` assets now resolve on Windows. Every provider registered its publish sources via `new URL(...).pathname`, which yields `/D:/...` on Windows (leading slash + percent-encoding) — so `vendor:publish --tag=auth-views` / `notification-schema` / `broadcast-client` / `cashier-*` / the boost guidelines all failed there with missing-source errors. Paths now convert via `fileURLToPath`. Surfaced by the new asset-on-disk test added with the sync-schema tag (#952), which went red on Windows CI.
