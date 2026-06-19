---
"@rudderjs/crypt": patch
---

Key-length guard on `CryptRegistry.set()`, zero-on-rotation fix, malformed-payload validation, `parseKey` base64 length check, and extracted `parsePayload`/`resolvedKeys` helpers.
