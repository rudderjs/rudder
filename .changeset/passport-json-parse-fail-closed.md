---
"@rudderjs/passport": patch
---

fix: corrupt JSON in OAuth model columns no longer throws a 500

`OAuthClient.getRedirectUris/getGrantTypes/getScopes`, `AccessToken.getScopes`, `AuthCode.getScopes`, and `DeviceCode.getScopes` were calling `JSON.parse` directly without a try-catch. Corrupt data in any of these columns would propagate a `SyntaxError` as a 500, taking down the OAuth authorization or token endpoint. All six methods now delegate to the existing helper functions that already wrap `parseJsonArray`, which fail-closes to `[]` with a `console.warn` on corrupt input.
