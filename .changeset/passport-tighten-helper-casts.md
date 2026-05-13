---
"@rudderjs/passport": patch
---

Internal cleanup: drop the `as any` bridge casts on every `*Helpers` call site (grants + routes + personal-access-tokens) by broadening the `*Record` interfaces in `models/helpers.ts` to accept the Model-instance shape. JSON-encoded columns (`redirectUris`, `grantTypes`, `scopes`) are now typed as `unknown` because the runtime parser already handles both `string` (wire shape) and `string[]` (`@Cast('json')` hydrated shape). Token-record `scopes`/`createdAt` are marked optional to match the Models, which don't `declare` them as typed fields today. Source casts: 31 → 9 (net -22). No public API or behavior change — `helpers.ts` stays internal, the only exported surface unaffected.
