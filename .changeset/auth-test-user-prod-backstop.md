---
"@rudderjs/auth": patch
---

fix(auth): refuse the `x-testing-user` auth bypass on a production runtime

`AuthMiddleware` honored `@rudderjs/testing`'s `x-testing-user` header whenever `APP_ENV === 'testing'`, authenticating the request as the arbitrary JSON identity it carried with no signature, session, or credential check. If `APP_ENV=testing` accidentally leaked onto a network-reachable staging/QA box, any caller could impersonate any user id (including an admin) by crafting the header. The bypass is now additionally gated on `NODE_ENV !== 'production'` — a real deploy sets `NODE_ENV=production`, so the synthetic-user header is inert there even under the misconfiguration. When the header is seen on a production runtime, the bypass is refused and a one-time warning is logged so the misconfiguration leaves an audit trail. Normal test runs (where `NODE_ENV` is `test`/unset) are unaffected.
