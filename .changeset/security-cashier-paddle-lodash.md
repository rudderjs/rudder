---
"@rudderjs/cashier-paddle": minor
---

Support `@paddle/paddle-node-sdk` 2.x and 3.x (peer range widened to `^1.0.0 || ^2.0.0 || ^3.0.0`). The 2.x+ SDK lines drop the bundled `lodash` dependency that carries the unfixable `_.template` code-injection advisory (GHSA-r5fr-rjxr-66jc — no patched lodash exists). The SDK is loosely typed and lazy-loaded, so no code changes are required; upgrade your installed `@paddle/paddle-node-sdk` to 3.x to clear the advisory.
