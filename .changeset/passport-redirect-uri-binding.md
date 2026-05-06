---
'@rudderjs/passport': patch
---

Bind `redirect_uri` to authorization codes and re-validate it on the consent endpoints (RFC 6749 §3.1.2.4 + §4.1.3). Closes findings P1, E3, and E4 from the passport-surface review.

**What changed**

- `OAuthAuthCode` gains a nullable `redirectUri` column. `issueAuthCode()` now persists the URI used at authorization, and `exchangeAuthCode()` requires the value submitted at the token endpoint to match exactly. Without this binding, an auth code obtained via one whitelisted redirect could be exchanged via any other registered redirect on the same client, breaking the OAuth threat model.
- `POST /oauth/authorize` (consent approve) and `DELETE /oauth/authorize` (consent deny) now look up the client and re-validate `redirect_uri` against the client's whitelist before emitting the redirect URL. Previously both handlers blindly trusted the request body; the deny handler also fell back to a hard-coded `http://localhost` default, which is now removed in favour of an explicit `invalid_request` rejection.
- New `redirectUri` field on `AuthCode` model + `AuthCodeRecord` helper interface.

**Migration**

Run a Prisma migration to add the new column to `oauth_auth_codes`:

```sql
ALTER TABLE oauth_auth_codes ADD COLUMN redirectUri TEXT;
```

Existing in-flight auth codes (≤10-minute lifetime) keep `redirectUri = null` and are exempt from the comparison so they remain exchangeable until they expire. All codes minted post-migration carry the binding.
