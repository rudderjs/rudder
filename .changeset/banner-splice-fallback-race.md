---
"@rudderjs/vite": patch
---

Fix the dev-banner splice losing the race on slow dev starts. The `rudderjs:banner` standalone-line fallback was armed from `configureServer` time, so apps taking >2s to reach Vike's startup banner (heavy `optimizeDeps.include`, codegen plugins) saw an early `➜ Rudder vX` line and a banner without the Rudder segment. The fallback is now armed from the http server's `listening` event (the banner prints on the next tick after it), keeping the old immediate arm in middleware mode, and the console.log wrapper is restored if the server closes before the banner ever matches.
