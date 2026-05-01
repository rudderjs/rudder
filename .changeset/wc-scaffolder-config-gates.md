---
'create-rudder-app': minor
---

Scaffolded `config/{cache,queue,mail,session}.ts` now gate their default driver on `isWebContainer()` so apps boot cleanly in StackBlitz/WebContainer without re-config (memory→cache, sync→queue, log→mail, cookie→session). On regular Node the gate returns `false` and the env-driven default is preserved exactly. Zero change for existing apps.
