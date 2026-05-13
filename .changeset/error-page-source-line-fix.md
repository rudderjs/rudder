---
'@rudderjs/server-hono': patch
---

fix(server-hono): widen error-page source-line scan + skip section when no throw found

The dev error page's "Exception Source" section sometimes highlighted an unrelated line (often a comment block) when running under Vite SSR. Root cause: Vite's Module Runner evaluates SSR modules via `new Function()`, which sidesteps Node's `--enable-source-maps`, and `ssr.sourcemap: 'inline'` is silently ignored. The result is stack-trace line numbers that are off by 40–90+ lines from the actual throw site.

`resolveErrorLine()` already compensated by scanning forward for a `throw` keyword, but the window was 20 lines (too narrow for typical Vite offsets) and the fallback was "first non-empty line" — which lands on a comment when the actual throw is further out.

Fix:
- Window expanded to 150 lines.
- Trigger pattern broadened to match `throw `, `throw new`, and `abort(` — with a word-boundary regex so mid-line `throw new` inside an `if {...}` block matches too.
- Comment lines (`//`, `*`, `/*`) are skipped during the scan rather than terminating it.
- When no trigger is found in the window, the function now returns `null` and the renderer drops the source-context section entirely — better than misleading with an unrelated line.

`resolveErrorLine` is now exported with an `@internal` tag so the regression coverage can pin specific offset/comment/abort scenarios.
