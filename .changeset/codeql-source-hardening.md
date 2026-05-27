---
"@rudderjs/support": patch
"@rudderjs/mcp": patch
---

Harden two CodeQL-flagged patterns in shipped source:

- `@rudderjs/support` — `Str.snake()` / `Str.headline()` previously detected the acronym→word boundary with `([A-Z]+)([A-Z][a-z])`, whose greedy `[A-Z]+` overlaps the following `[A-Z]` (a polynomial-ReDoS on long all-caps input). Rewritten to a fixed-width lookbehind `(?<=[A-Z])([A-Z][a-z])` — output is byte-identical for every case, no ambiguous quantifier.
- `@rudderjs/mcp` — the OAuth2 `WWW-Authenticate` challenge escaped `"` in `error_description` but not `\`, so a description ending in a backslash could escape the closing quote and break out of the RFC 7235 quoted-string. Now escapes `\` before `"`.
