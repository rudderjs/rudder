---
'@rudderjs/passport': patch
---

refactor: document hidden contracts; collapse grant + bearer duplication; tighten 5 mixin casts

- Extract `parseScopes()` (used by all 4 grants) and `verifyConfidentialCredentials()` (used by auth-code, client-credentials, refresh-token) into shared helpers under `grants/`. The four-step confidential-secret check (require-confidential, missing-secret, null-on-row, hash-mismatch) now lives in one place and can't drift across grants.
- Refactor `bearer.ts`: extract `authenticateBearer()` returning a discriminated outcome (`authenticated` / `no-bearer` / `revoked` / `invalid`). `BearerMiddleware` and `RequireBearer` now share the verify-and-stamp path and only diverge on the failure handler. Eliminates ~75 lines of near-identical duplication and adds a typed `RawAuthBag` so the raw-request cast is no longer `Record<string, unknown>`.
- Tighten 5 `(this as any)` casts in `personal-access-tokens.ts` to a narrow `HasApiTokensThis` interface (`id: string`, optional `__passport_token`).
- Document four hidden contracts in `packages/passport/CLAUDE.md`: the `__rjs_user` / `__passport_token` raw-bag stamp pattern (and the subtlety that `req.user.tokenCan()` doesn't work because the plain copy drops mixin methods), the `id: string` assumption on `HasApiTokens`'s Base, the `parseJsonArray` fail-closed-with-warn behavior, and the single-authority status of `grants/verify-client.ts`.

No public-API change.
