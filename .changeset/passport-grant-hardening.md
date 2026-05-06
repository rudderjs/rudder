---
'@rudderjs/passport': patch
---

Two security hardenings on the OAuth2 grant surface:

- **PKCE: reject `code_challenge_method=plain` for public clients** (RFC 7636 §4.4.1 + OAuth 2.0 BCP). With `plain`, verifier == challenge, so a stolen authorization code is enough to mint tokens — defeating PKCE entirely. Confidential clients keep the `plain` option for backward compat. Closes finding P3 from the passport-surface review.
- **Constant-time comparison on all 4 hashed-credential / verifier sites** (3 client-secret compares + 1 PKCE verifier compare). New `safeCompare()` helper uses `crypto.timingSafeEqual` after a length pre-check, replacing `!==` which short-circuits on first mismatch. Closes finding P5.
