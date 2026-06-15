---
"@rudderjs/vite": patch
---

Show Rudder first in the dev startup banner. `spliceRudderVersion()` now prepends the `Rudder v<x> ·` segment at the front of Vike's banner (before `Vike v<x>`) instead of inserting it just before `ready in`, so the line reads `Rudder v<x> · Vike v<x> · Vite v<x> · ready in <n> ms` — the framework brand the developer is running comes first. ANSI styling and the dim `·` separators are preserved; non-banner lines are still left untouched.
