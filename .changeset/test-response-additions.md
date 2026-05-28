---
'@rudderjs/testing': minor
---

Expand `TestResponse` with Laravel-parity content, cookie, JSON, and status assertions.

**New status helpers:** `assertAccepted` (202), `assertBadRequest` (400), `assertConflict` (409), `assertGone` (410), `assertTooManyRequests` (429).

**JSON variants:**
- `assertExactJson(expected)` — deep-equal at top level (no extra keys).
- `assertJsonMissingExact(expected)` — opposite of `assertExactJson`.
- `assertJsonFragment(fragment)` — match every key/value pair on any object node in the body (walks arrays and nested objects).

**Content assertions:**
- `assertContent(value)` — raw body equals.
- `assertSee(value)` / `assertDontSee(value)` — substring match on raw body.
- `assertSeeText(value)` / `assertDontSeeText(value)` — strips HTML tags + collapses whitespace before matching.
- `assertSeeInOrder([a, b, c])` — substrings appear in this order.

**Cookie assertions** (response `Set-Cookie` inspection):
- `assertCookie(name, value?)` — Set-Cookie present (optionally verify value substring).
- `assertCookieMissing(name)` — no Set-Cookie for that name.

To support multi-value `Set-Cookie`, `TestResponse` now exposes a `setCookies: string[]` field (one entry per cookie set; empty when none). Captured automatically from `Response.headers.getSetCookie()` when available. Pre-existing `TestResponse` constructor calls remain compatible — the new `setCookies` constructor parameter is optional and defaults to `[]`.

Found by the Phase 3 testing-ergonomics audit (cluster 5a — pure-additive subset of the TestResponse expansion).
