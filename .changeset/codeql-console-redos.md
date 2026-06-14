---
"@rudderjs/console": patch
---

Harden `parseSignature` against a polynomial-time regex blowup. The per-token scan used `\{([^}]+)\}`, which on a signature with many unclosed `{` (e.g. `{{{{…`) backtracks quadratically. The inner class is now `[^{}]+`, keeping the match linear. Behavior is unchanged for all valid signatures (a `{...}` block never contains `{`).
