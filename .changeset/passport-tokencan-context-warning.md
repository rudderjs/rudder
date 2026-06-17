---
"@rudderjs/passport": patch
---

fix(passport): warn in dev when `tokenCan()` is called with no bearer context

`HasApiTokens.tokenCan()` reads scopes from the token that `RequireBearer()` / `BearerMiddleware()` stamps onto the resolved user model. Called outside a bearer-authenticated request (a session route, console command, queue job, or on the flat `req.user` copy), it returned `false` for every scope with no signal that the check was meaningless rather than a legitimate denial. It now emits a one-time development warning explaining the context requirement; production behavior (deny-by-default) is unchanged.
