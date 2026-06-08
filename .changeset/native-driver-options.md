---
"@rudderjs/database": patch
---

Forward `config.options` from a native connection to the underlying driver.

`NativeConfig` gains an `options?: Record<string, unknown>` field that is threaded through to each built-in driver's `open()` — mysql2 pool/`timezone` options, porsager `postgres()` options (`max`, `ssl`), or better-sqlite3 `Database` options (`readonly`, `timeout`). The driver configs already accepted an `options` field, but the adapter's `openDriver` dead-ended at the URL and silently dropped the app's declarative options. Replica drivers (`readUrls`) open with the same options as the write connection.

The options are folded into the dev-HMR cache signature, so editing them in `config/database.ts` disposes and reopens the connection instead of reusing a stale driver. The no-options signature is unchanged.
