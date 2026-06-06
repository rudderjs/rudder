---
"@rudderjs/core": minor
"create-rudder": minor
---

`server` is now optional in `Application.configure()` — when omitted, the framework auto-resolves `@rudderjs/server-hono` and constructs it with `config('server')`, so `bootstrap/app.ts` no longer needs the adapter import:

```ts
export default Application.configure({ config: configs, providers })
  .withRouting({ ... })
  .create()
```

Passing `server: hono(configs.server)` explicitly still works and remains the way to use a custom adapter (or to bundle to a single file, where the runtime lookup can't be statically traced). When neither an explicit adapter nor `@rudderjs/server-hono` is available, the first request fails with a clear install-hint error; the CLI path (`boot()`) never needs a server and is unaffected.

`create-rudder` scaffolds the new adapter-free `bootstrap/app.ts` (the generated app still depends on `@rudderjs/server-hono` — it is resolved at runtime).
