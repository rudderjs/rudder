---
'@rudderjs/core': minor
---

Export the `ConfigKey` / `ConfigValue` types (main entry + `/client`) so apps can build a strict `config()` wrapper that rejects undeclared dot-paths — the framework's own `config()` deliberately keeps its loose overload. Recipe: `const configStrict = <K extends ConfigKey>(key: K): ConfigValue<K> => config(key)`.
