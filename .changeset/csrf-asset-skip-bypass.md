---
"@rudderjs/middleware": patch
---

Fix a CSRF bypass in `CsrfMiddleware`. The static-asset / Vite-internal skip (paths starting with `/@` or whose last segment contains a `.`) ran before the method check and token validation, so it short-circuited **every** request matching the heuristic — including unsafe ones. Any state-changing request to a path whose last segment contains a dot (e.g. `POST /users/john.doe`, `PUT /files/report.csv`, `DELETE /webhook.json`) skipped CSRF validation entirely.

The skip is now gated on safe methods (GET/HEAD/OPTIONS) only — those are the asset requests it was meant to fast-path — so it can never bypass validation for POST/PUT/PATCH/DELETE.
