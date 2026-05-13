/**
 * Parse the space-separated `scope` parameter from a token-endpoint request
 * into a deduplicated-by-position string array.
 *
 * RFC 6749 §3.3 defines `scope` as a space-delimited list. `.filter(Boolean)`
 * drops the leading/trailing/double-space tokens that some SDKs emit, since
 * a stray empty string would fail the scope-registry / per-client-allowlist
 * checks downstream with a confusing "unknown scope: " message.
 *
 * Returns `[]` when the parameter is missing — the same shape every grant
 * needs ("no scope requested"), so callers don't have to ternary every
 * read.
 */
export function parseScopes(scope: string | undefined): string[] {
  return scope ? scope.split(' ').filter(Boolean) : []
}
