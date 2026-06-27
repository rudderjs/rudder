---
"create-rudder": patch
---

Pin the scaffolded app's Vike dependency to `0.4.259` (exact). Vike `0.4.260` introduced a render-engine regression that crashes scaffolded apps during SSR (`[vike@0.4.260][Bug]`), and the previous `^0.4.257` range resolved to it. Pinning to the last known-good version restores working scaffolds; will float forward once Vike ships a fixed release.
