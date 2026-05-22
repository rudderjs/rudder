---
"@rudderjs/vite": patch
---

Vite scanners no longer false-positive on commented-out declarations. Three fixes in the same class:

- **`ROUTE_EXPORT_RE`** in `views-scanner.ts` — anchored at `^export` (multiline flag) so a commented `// export const route = '/old-path'` doesn't get picked up as the active route override. Previously the `[\s;]` alternative matched the space after `//`, silently swapping the view's URL to a stale value with no error surface.
- **`PROPS_EXPORT_RE`** in `views-scanner.ts` — same `^export` anchor. A commented `// export interface Props { … }` no longer fools the scanner into emitting a `registry.d.ts` entry that imports a non-existent type (which would break tsc on the next compile).
- **`routes-scanner.ts`** — new `stripJsComments()` pass strips `//` line comments + `/* … */` block comments before the named-routes regex runs. A commented `// Route.get('/admin', h).name('admin')` no longer populates `RouteRegistry` with a name that has no runtime registration backing it (which would let `route('admin')` type-check but throw). String literals are preserved (the stripper tracks single-/double-/template-quote state), so URLs like `Route.get('https://example.com/api', h).name('proxy')` keep their `//` characters intact.

Same fix shape as `PRERENDER_DECL_RE` in #620. No public API changes; existing regex matches that aren't inside comments behave unchanged.
