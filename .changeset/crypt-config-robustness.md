---
"@rudderjs/crypt": patch
---

Validate rotation keys at boot and fail clearly on non-serializable input.

- **`previousKeys` are now length-checked at boot**, mirroring the primary key's 32-byte guard. A misconfigured rotation key (wrong length / stray whitespace) was accepted at boot and silently decrypted nothing, surfacing only as a runtime "no matching key" on live ciphertext. It now throws `previousKeys[i] must be 32 bytes` at boot.
- **`Crypt.encrypt` throws a clear error for a value that serializes to `undefined`** (an `undefined`, function, or symbol) instead of an opaque `Buffer.from(undefined)` TypeError.
