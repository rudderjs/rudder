---
"@rudderjs/boost": patch
---

Three robustness/security fixes.

- **No stale skill files.** `boost:install` / `boost:update` copied skill directories with `cpSync`, which merges into an existing directory and never prunes — so a file removed or renamed in a newer package version lingered, and an installed skill became a union of all historical versions over upgrades. The copy now mirrors the source (remove-then-copy).
- **`config_get` redacts secrets.** The MCP tool returned config file source verbatim, leaking any hardcoded secret a developer left inline. It now masks `env('KEY', 'default')` fallback literals, string literals assigned to secret-looking keys (`secret`/`password`/`token`/`*_key`/`client_secret`/…), and passwords embedded in credentialed URLs, while keeping the file structure intact so it stays useful to the assistant.
- **Frontmatter / docs-index edge cases.** Frontmatter parsing now normalizes CRLF (no more stray `\r` clinging to the last value or the body) and only accepts a real `---` closing fence (a malformed `----` no longer corrupts the split). The docs index no longer treats `#` lines inside fenced code blocks as headings, and orders both its scan and its results deterministically so equally-scored results don't shuffle across platforms.
