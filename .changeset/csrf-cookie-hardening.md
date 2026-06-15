---
"@rudderjs/middleware": patch
---

Harden the CSRF double-submit cookie.

- **Add a `secure` option to `CsrfMiddleware`** and emit `Secure` by default in production (`NODE_ENV === 'production'`). Previously the token cookie was always written without `Secure`, so on any plaintext HTTP request a network attacker could read the token (and forge the matching header) or pin a known value. Mirrors `@rudderjs/session`'s cookie policy.
- **Support `__Host-`/`__Secure-` cookie name prefixes.** Setting `cookieName: '__Host-csrf_token'` now forces `Secure` automatically (browsers reject those names otherwise) and, via the prefix's ban on a `Domain` attribute, blocks sibling-subdomain cookie injection.
- **Reject duplicate token cookies.** An unsafe request carrying more than one cookie with the configured name now fails closed with `419 CSRF_DUPLICATE_COOKIE` instead of silently trusting the last occurrence (which a shadowing cookie could control).
- **Escape regex metacharacters in `getCsrfToken`.** A custom `cookieName` such as `csrf.token` is now matched literally, matching the server's exact-key lookup, instead of letting `.` act as a wildcard that could read an unrelated cookie.
