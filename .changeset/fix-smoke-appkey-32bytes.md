---
"create-rudder-app": patch
---

fix: smoke `default`/`todos`/`demos-all` profiles use 32-byte appKey

The three older smoke profiles passed `'smoke-test-app-key-padding-32-bytes!'`
(36 bytes) base64-encoded. They didn't crash because all three set
`crypt: false`, but flipping `crypt: true` (or copy-pasting one of these
profiles to draft a new one with crypt enabled) immediately blew up with
`APP_KEY must be 32 bytes for AES-256. Got 36 bytes.` from `CryptProvider.boot()`.

All four profiles now use `'smoke-test-app-key-padding-32b!!'` (32 bytes
exactly) — same value the `no-db` profile already used. No behavior change
for current runs; defensive against future profile additions or smoke
maintenance turning crypt on.
