---
"@rudderjs/vite": patch
---

Dev HMR: scope SSR invalidation to the edited file's import subtree instead of dumping the whole module graph. On a backend edit (`routes/`, `bootstrap/`, `app/`), the `rudderjs:routes` plugin now invalidates only the changed file + its transitive importers (up to the bootstrap entry), leaving framework packages and unrelated app modules warm — so Vike's runner re-fetches far less on the next request. Measured on the playground: edit-to-ready dropped from ~1.1s to ~75ms (`watcher→reimport` ~911ms → ~45ms). Falls back to the previous whole-graph invalidation when the changed file isn't tracked in the SSR graph, so behaviour is never worse. Dev-only; no production-build or API change.
