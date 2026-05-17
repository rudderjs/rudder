---
'@rudderjs/passport': patch
---

Route `Passport`'s configuration (scopes, lifetimes, RSA keys, custom models, authorization-view fn, route-ignored toggle, issuer, device-flow polling cap) through `globalThis` so the configuration survives the case where `@rudderjs/passport` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/passport` inline (grant handlers and bearer middleware read `Passport.*`) but `PassportProvider.boot()` and `Passport.tokensCan()` / `Passport.tokensExpireIn()` calls in `AppServiceProvider.boot()` can run from a `node_modules` copy resolved via the provider auto-discovery manifest. Without a shared store, scopes/lifetimes/RSA keys configured from the externalized copy would never be visible to grant handlers reading the bundled copy — every `/oauth/*` request would behave as if Passport was never configured.

No public API change — every static setter/getter on `Passport` keeps its existing surface (`tokensCan`, `tokensExpireIn`, `setKeys`, `loadKeysFrom`, `useClientModel`, `authorizationView`, `ignoreRoutes`, `useIssuer`, `deviceMaxInterval`, `reset`, etc.). Defensive migration per the #499 static-state singleton audit. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), #500 (pennant), #501 (cache), #502 (queue), #503 (mail), #504 (storage), #505 (hash).
