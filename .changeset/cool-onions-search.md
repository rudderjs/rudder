---
"@rudderjs/cli": minor
---

Add `optimize:clear` and `rudder fresh`. `optimize:clear` removes the framework's filesystem caches (`bootstrap/cache/` provider manifest, `node_modules/.vite/` dep-optimizer cache) and is skip-boot, so it works when a corrupt cache is the reason the app won't boot. `fresh` is the one-command dev reset: `migrate:fresh` (pass `--seed` to also seed) → `cache:clear` (best-effort) → framework filesystem caches, aborting before touching caches if the migrate fails. Pair with `@rudderjs/core`'s self-healing provider manifest — clearing `bootstrap/cache/` relies on boot regenerating it.
