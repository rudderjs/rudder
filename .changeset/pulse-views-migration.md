---
"@rudderjs/pulse": major
---

**Breaking:** rename `*Aggregator` classes to `*Recorder` to align with Laravel Pulse's vocabulary — recorders listen to events and call `Pulse::record()`; "aggregation" is the storage-side bucketing strategy, not a class-naming concept. The runtime behavior is unchanged.

Renames:

- `RequestAggregator` → `RequestRecorder`
- `QueueAggregator` → `QueueRecorder`
- `CacheAggregator` → `CacheRecorder`
- `ExceptionAggregator` → `ExceptionRecorder`
- `UserAggregator` → `UserRecorder`
- `QueryAggregator` → `QueryRecorder`
- `ServerAggregator` → `ServerRecorder`
- `Aggregator` interface → `Recorder`
- `src/aggregators/` directory → `src/recorders/`

Bundled with this rename: migrate the UI to the canonical package-UI shape (`views/vanilla/` + `registerPulseRoutes()`), matching `@rudderjs/auth`, `@rudderjs/telescope`, and `@rudderjs/horizon`. The Dashboard moves from `src/ui/{dashboard,layout}.ts` to `src/views/vanilla/{Dashboard,Layout}.ts`, with the `html\`\`` auto-escape helper available in `_html.ts`. Route registration is centralised in a new `src/routes.ts` exporting `registerPulseRoutes(storage, opts)`; the API handler functions stay in `api/routes.ts` as pure functions. Public functional API (`PulseProvider`, `Pulse` facade, configuration) is unchanged apart from the class renames above.

**Migration:** find / replace `*Aggregator` → `*Recorder` and `import type { Aggregator }` → `import type { Recorder }` in any code that imports recorder classes by name from `@rudderjs/pulse`. Most apps don't reference these directly — the provider instantiates them — so the change is invisible. Apps that imported from the deep `@rudderjs/pulse/aggregators/*` paths will need to update those (the `aggregators/` directory no longer exists).
