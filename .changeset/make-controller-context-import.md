---
'@rudderjs/cli': patch
---

`make:controller` (and `--resource` / `--api` / `--singleton`) generated a file that didn't compile: every stub variant imported `Context` from `@rudderjs/core`, which doesn't export that type — `TS2305: Module '"@rudderjs/core"' has no exported member 'Context'`. Replaced with the real handler types `AppRequest, AppResponse` from `@rudderjs/contracts` (the same types `RouteHandler` is built on and that `make:middleware` already uses). Handler signatures now read `(req: AppRequest, res: AppResponse)` — typed out of the box, no edit required. Found by the Phase 1 scaffolder audit.
