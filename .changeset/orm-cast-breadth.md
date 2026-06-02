---
"@rudderjs/orm": minor
---

Cast breadth (Laravel parity): three new casts in the built-in registry.

- **`decimal:N`** — parameterized fixed-precision cast (`static casts = { price: 'decimal:2' }` / `@Cast('decimal:2')`). Both read and write normalize to a string with N fractional digits (`'9.50'`) — strings avoid float-rounding drift on money columns.
- **enum** — a TypeScript `enum` (or plain const object) used directly as a cast (`static casts = { status: StatusEnum }`). Validates the value against the enum's members on read/write and throws a clear error (listing the allowed set) on an unknown value. Numeric enums are handled — the reverse-mapping labels are not treated as valid stored values.
- **`hashed`** — one-way hash on write via the optional `@rudderjs/hash` peer (resolved synchronously through its shared registry, so `cast.ts` stays client-bundle safe). Re-hashing an already-hashed value is a no-op (Laravel's behavior). Requires a sync-capable driver (bcrypt); argon2 throws a clear message. On read the stored hash is returned verbatim.
