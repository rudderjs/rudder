// Shared internal constants for @rudderjs/session. Kept in one place so the
// runtime (resolveSessionSecret) and the doctor check can never disagree about
// what counts as the public placeholder secret.

/**
 * The public placeholder the shipped config templates default `secret` to when
 * neither SESSION_SECRET nor any fallback is set. Both the runtime
 * (`resolveSessionSecret()`) and the `session:secret` doctor check treat it —
 * and an empty string — as "no secret configured" so it can never become a
 * real, world-known signing key. Defined here, imported by both, so the two
 * can never drift (a mismatch would let the doctor green-check a forgeable key).
 *
 * @internal
 */
export const SESSION_SECRET_PLACEHOLDER = 'change-me-in-production'
