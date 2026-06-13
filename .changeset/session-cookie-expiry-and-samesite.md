---
"@rudderjs/session": patch
---

Three session-cookie hardening fixes:

- **Cookie-driver sessions now expire server-side.** The signed cookie payload carried no timestamp and `persist`'s TTL was discarded, so a captured cookie-driver cookie replayed indefinitely — the browser's `Max-Age` is only a client-side hint an attacker bypasses by setting the header directly. The signed payload now embeds an absolute `exp` (from the configured `lifetime`) and the driver rejects an expired cookie on load. Cookies minted before this change carry no `exp` and are accepted during the migration window, picking up an expiry the next time they're re-persisted.
- **`SameSite=None` cookies are now always emitted with `Secure`.** Every modern browser silently drops a `SameSite=None` cookie that lacks `Secure`, which presented as "the session never persists" with no error. `Secure` is now forced whenever `sameSite` is `none`, regardless of `cookie.secure`.
- **A `session.save()` failure no longer turns a successful response into a 500.** When the handler succeeded but persisting the cookie threw (e.g. a transient redis blip), the middleware re-threw and masked the already-produced 200. It now logs the save error and preserves the response; a handler error is still surfaced unchanged.
