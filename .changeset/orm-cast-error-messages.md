---
"@rudderjs/orm": patch
---

`encrypted` cast now throws a clear, actionable error naming the column and directing to `CryptProvider` registration when the crypt bridge is absent, instead of the previous opaque "requires @rudderjs/crypt. Run: pnpm add" message.
