---
"@rudderjs/session": patch
"create-rudder": patch
---

Stop signing session cookies with a public placeholder secret (critical).

The shipped config default was `secret: Env.get('SESSION_SECRET', 'change-me-in-production')`, and the scaffolder emits an `APP_KEY` but no `SESSION_SECRET`. The documented "sessions fall back to APP_KEY" behavior was never actually wired, so any app that did not explicitly set `SESSION_SECRET` signed every session cookie with the open-source literal `change-me-in-production` - a key anyone can read. With that key an attacker forges a fully valid signed cookie for any user (full session forgery / auth bypass on the cookie driver; arbitrary attacker-chosen session id on the redis driver).

- **The `APP_KEY` fallback is now real.** `resolveSessionSecret()` resolves the effective signing key: a genuine `SESSION_SECRET` wins; otherwise it falls back to `APP_KEY` (stripping the scaffolder's `base64:` prefix); only when neither exists does it keep the placeholder and emit a loud boot warning. It does not throw - session boots transitively in apps that never serve sessions and `APP_ENV` defaults to `production`, so a boot-throw would break unrelated boots. **Upgrade note:** an app that was (unknowingly) signing with the placeholder will now sign with `APP_KEY`, so existing session cookies are invalidated once and users re-authenticate. Set a stable `APP_KEY`/`SESSION_SECRET` before deploying.
- **Doctor now tells the truth.** `session:secret` reports `error` when the effective key is the public placeholder (both `SESSION_SECRET` and `APP_KEY` unset, or `SESSION_SECRET` literally set to the placeholder with no `APP_KEY`), `warn` when the placeholder is set but `APP_KEY` provides a real key, and `ok` for a real secret or the APP_KEY fallback. A new `session:cookie-secure` check warns when `SESSION_SECURE` is off in a production environment.
- **Config templates** (scaffolder + playground) default `secret` to empty (sign with `APP_KEY`) instead of baking in the public placeholder.
- **`SessionInstance.has()`/`get()`/`getFlash()`** now use `Object.hasOwn` instead of the `in` operator, so an inherited member name (`toString`, `constructor`, `hasOwnProperty`, ...) is no longer reported as present or returned in place of the fallback.
