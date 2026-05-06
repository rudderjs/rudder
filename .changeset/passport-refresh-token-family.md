---
'@rudderjs/passport': patch
---

Detect refresh-token reuse and revoke the entire rotation family on detection (RFC 6819 §5.2.2.3 / OAuth 2.0 Security BCP §4.14). Closes finding P4 / M(H4) from the passport-surface review.

**What changed**

- `OAuthRefreshToken` gains a nullable `familyId` column (indexed). `issueTokens()` stamps a freshly generated UUID when no family is passed in, and `refreshTokenGrant()` propagates the existing id onto the rotated pair so a session's full chain shares one identifier.
- When a previously-rotated refresh token is presented again, the grant now walks `WHERE familyId = X` and revokes every access + refresh token in that family before throwing `invalid_grant`. Previously the attacker who stole a refresh token before legitimate rotation could keep rotating forever while the victim was silently logged out.
- New `familyId` field on `RefreshToken` model + `RefreshTokenRecord` helper interface; `issueTokens()` now accepts an optional `familyId` to support the rotation pass-through.

**Migration**

Run a Prisma migration to add the new column + index to `oauth_refresh_tokens`:

```sql
ALTER TABLE oauth_refresh_tokens ADD COLUMN familyId TEXT;
CREATE INDEX oauth_refresh_tokens_familyId_idx ON oauth_refresh_tokens(familyId);
```

Existing refresh tokens (≤2-week lifetime by default) keep `familyId = null` and are exempt from the cascade so a legacy reuse still throws `invalid_grant` but does not affect unrelated rows. All tokens minted post-migration carry a family.
