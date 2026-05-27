---
"@rudderjs/session": patch
"create-rudder": patch
---

Two fixes found by dogfooding the playground.

- `@rudderjs/session` — the `session:secret` doctor check returned a green "unset (sessions will sign with APP_KEY)" even when `APP_KEY` was *also* unset, contradicting the `APP_KEY` error the env category raises and giving false reassurance (there's no signing secret at all). It now warns when both are unset.
- `create-rudder` — scaffolded apps with a frontend renderer rendered pages with **no `<title>`**. New projects now ship a `pages/+title.ts` that defaults the document title to the app name and lets a controller override it per page via the view props (`view('dashboard', { title: 'Dashboard' })`). The no-frontend recipe's hand-rolled `+onRenderHtml` now uses the app name too, instead of a hardcoded `RudderJS`. (Defined in `+title.ts` rather than inline in `+config.ts` because vike rejects a function `title` there — "runtime in config".)
