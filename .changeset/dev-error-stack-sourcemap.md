---
"@rudderjs/server-hono": patch
"@rudderjs/vite": patch
---

Fix the dev error page showing the wrong source line for thrown route handlers. In dev, route handlers run through Vite's SSR module runner as `eval`'d code, so V8 reports line numbers in transformed-code coordinates (a throw at source line 235 could surface as ~140) — and the Ignition page's text heuristic couldn't recover when the wrong line happened to land on unrelated real code, highlighting a completely different route.

`@rudderjs/vite` now registers a dev-only `globalThis.__rudderjs_fix_stacktrace__` hook (Vite's `ssrFixStacktrace`), and `@rudderjs/server-hono` applies it to the error at the top of `onError` — before the app's error handler, the Ignition page, and logging all read the stack. The reported location, highlighted source line, stack frames, and any JSON debug trace now point at the true throw site. The existing line heuristic remains as a fallback for cases with no sourcemap remap (e.g. `tsx`-run CLI errors). No effect in production (the hook is only registered under `vite dev`).
