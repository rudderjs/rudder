---
"@rudderjs/router": patch
---

Four router correctness fixes:

- **`route()` now URL-encodes path param values** (`encodeURIComponent`), so a value containing `/`, `?`, `#`, `&`, spaces, etc. can no longer inject extra path segments, a query string, or a fragment into the generated URL (Laravel `route()` parity). Query params were already encoded.
- **Chained `.query()` / `.body()` validators now run after group-stack middleware**, not before it. Previously they were unshifted to the front of the route's middleware, so a validator declared on a route inside `router.group({ middleware: [auth] })` ran before that group's auth/guard. This now matches the opts-object form (`{ query }, handler`). No change for routes without group middleware.
- **Resource `only` now wins over `except`** (Laravel parity, they are mutually exclusive). Previously the two were AND-composed, so `apiResource`'s injected `except: ['create', 'edit']` could silently strip a verb a caller explicitly requested via `only`.
- **Signed-URL verification dropped a dead non-constant-time fallback.** `isValidSignature` now always uses the constant-time `timingSafeEqual` path and fails closed if crypto is somehow unavailable, instead of falling back to a `===` string compare.
