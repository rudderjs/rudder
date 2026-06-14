---
"@rudderjs/passport": patch
---

Bearer scope enforcement now reads the access token's scopes from the live DB row instead of the JWT claim. The DB row is the same mutable authority `revoked` lives on, so narrowing a token's scopes there (an operator action) takes effect on the next request, instead of being inert until the JWT naturally expires. For a normally-issued token the two are identical — `issueTokens` writes the same scopes to the row and the JWT — so this is a no-op for the common path and a correctness fix for the edit-then-expect-it-to-apply case.
