---
'@rudderjs/passport': patch
---

Storage hygiene sweep — defense-in-depth on passport models.

Closes M1, M6, M-L1, M-L2, M-L4, M-L5, M-L6 in
`docs/plans/2026-05-06-passport-surface-review-fixes.md`.

- **`revoked` removed from `fillable`** on `AccessToken`, `RefreshToken`, and
  `AuthCode`. Lifecycle flips happen through `instance.revoke()` (token
  models) or `QueryBuilder.where(...).updateAll({ revoked: true })` (grants);
  both bypass the mass-assignment filter. Defense-in-depth — a future
  caller-controlled `Model.create()` payload can no longer pre-mark a row as
  revoked.
- **`revoke()` instance methods** on `AccessToken` and `RefreshToken` now
  `this.revoked = true; await this.save()` instead of the prior
  `(this as any).id`/static-update pattern.
- **`AccessToken.userId` and `clientId` are `@Hidden`** so `toJSON()` strips
  them by default. Routes that surface `user.tokens()` no longer leak
  ownership mappings; admin views opt in via
  `instance.makeVisible(['userId', 'clientId'])`. `tokens()` JSDoc now
  documents the per-user scoping requirement.
- **`OAuthClient` JSON columns** carry `@Cast('json')`. `redirectUris`,
  `grantTypes`, `scopes` hydrate as `string[]` automatically. Existing
  `JSON.stringify([...])` write callsites continue to work — `castSet('json')`
  returns string inputs verbatim.
- **Confidential-client null-secret guard** added to `client_credentials`,
  `refresh_token`, and `authorization_code` grants. Catches a future refactor
  that could otherwise mask `client.secret = null` as authenticating against
  an empty string.
- **`parseJsonArray`** in `models/helpers.ts` now logs a
  `[@rudderjs/passport]` warning (with truncated raw value + parse error)
  before returning `[]` on corrupt input. Behavior stays fail-closed;
  persistent corruption is no longer invisible.
- **Stale `helpers.ts` comment** rewritten to reflect the post-PR-#111
  Model-instance reality.
- **`personal-access-tokens.revokeAllTokens()`** collapsed from a
  read-then-N+1-update loop into a single bulk `QueryBuilder.updateAll`. Same
  result, one round-trip.

No schema changes, no migrations.
