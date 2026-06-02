---
"@rudderjs/orm": minor
---

Model: `static keyType = 'uuid' | 'ulid'` for application-generated primary keys. When set and the primary key is unset on `Model.create()` / `instance.save()`, the ORM stamps a fresh UUID v4 (Web Crypto `randomUUID`) or a lexicographically sortable 26-char Crockford Base32 ULID before the insert — Laravel's `HasUuids` / `HasUlids` traits. Implemented purely in the Model layer, so all three adapters get it with no contract/adapter change. Default `'int'` stays database-assigned auto-increment (unchanged). A caller-supplied key is never overwritten.
