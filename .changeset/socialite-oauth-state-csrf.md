---
'@rudderjs/socialite': minor
'@rudderjs/session': patch
---

Add OAuth state generation/validation to `@rudderjs/socialite` (O5 — closes the login-CSRF / state-fixation gap across every provider).

Previously, `getRedirectUrl(state?)` accepted an optional `state` but the framework neither generated nor validated it — `user(req)` ignored `query.state` entirely. Laravel Socialite (the inspiration) auto-generates and validates by default; this port had dropped that. Without state validation, an attacker can swap their authorization code into a victim's callback and link the victim's session to the attacker's social account.

What changed:

- **Stateful by default.** `redirect()` / `getRedirectUrl()` mints a 40-hex-char CSPRNG token, stores it on the session under `socialite_state:<provider>`, and embeds it in the OAuth URL. `user(req)` extracts the returned `state` from the query (or, for Apple's `form_post` callback, from the request body), compares with `crypto.timingSafeEqual` against the session-stored value, and throws `InvalidStateException` on mismatch / missing state / no session in context.
- **One-time use.** Both successful and failed validation clear the session slot — a leaked or sniffed `state` cannot be replayed.
- **Per-provider namespace.** `socialite_state:github`, `socialite_state:google`, etc. — concurrent OAuth flows on the same session don't collide.
- **`.stateless()` opt-out.** For OAuth flows that can't reach the session (mobile, S2S token grants), `.stateless()` returns `this` and disables both generation and validation. Call-site equivalent of Laravel's `->stateless()`.
- **`@rudderjs/session` is now a peer dep.** Stateful default needs the session in context. Apps using `@rudderjs/socialite` on the `web` group already have it (auto-installed by `SessionProvider`).

`@rudderjs/session`: adds `_runWithSession(session, fn)` test-only helper so other packages can exercise code that goes through the `Session` static facade in unit tests without standing up the full middleware. Marked `@internal`; not part of the runtime contract.

Migration notes:

- Apps already on the `web` group with `@rudderjs/session` registered get the protection automatically — no code changes.
- Apps that mount Socialite routes in the `api` group (no session) need to either opt into session-per-route or call `.stateless()` on each driver call. Stateless mode is appropriate for token-grant flows but **don't** use it on browser-initiated OAuth redirects without your own state implementation.
- Existing callers passing `state` explicitly to `getRedirectUrl(state)` keep working — caller-supplied state always wins and skips the generator.
