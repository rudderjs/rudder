---
"@rudderjs/queue-inngest": minor
---

Require `inngest` `^3.54.0` (was `^3.0.0`) to clear a high-severity advisory in the inngest 3.5x line and to pick up its updated OpenTelemetry dependency ranges. Re-resolving the transitive `@opentelemetry/*` tree and `protobufjs` clears the critical `protobufjs` advisory and the high `@opentelemetry/auto-instrumentations-node` / `sdk-node` / `exporter-prometheus` advisories. No source changes — the `Inngest` API used (`new Inngest`, `createFunction`, `send`) is unchanged within the 3.x line.
