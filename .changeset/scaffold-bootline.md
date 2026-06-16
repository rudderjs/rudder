---
'create-rudder': patch
---

feat(create-rudder): scaffolded AppServiceProvider logs via bootLine()

The generated `AppServiceProvider.boot()` now calls `bootLine(\`${this.app.name} ready\`)` instead of a raw `console.log(\`[AppServiceProvider] booted ...\`)`. `bootLine()` (from `@rudderjs/core`) prints a Vike-style `➜` line in dev that sits with the framework's startup banner, and degrades to a plain line in production, so a freshly scaffolded app's boot output is consistent with the rest of the framework instead of an out-of-place bracketed debug print.
