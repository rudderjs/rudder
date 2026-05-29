---
"@rudderjs/storage": patch
---

fix: contain LocalAdapter paths within the disk root (path traversal)

`LocalAdapter` derived every filesystem path with `path.join(this.root, filePath)`,
which doesn't stop `..` segments (or an absolute `filePath`) from escaping the
configured disk root. An app that passed untrusted input — an upload filename, a
user-supplied storage key — to `storage().put()/get()/delete()/copy()/move()/…`
could read or write outside the disk (e.g. `put('../../etc/cron.d/x', …)`).

`abs()` (and the visibility sidecar resolver) now resolve the path and throw a
new `StoragePathTraversalError` when the result lands outside the root, matching
Laravel's behaviour of keeping every operation within the disk. The traversal
check runs before the defensive `try/catch` in `get`/`exists`/`delete`/`list`/
`getVisibility`, so an escaping path fails loudly instead of being swallowed
into a `null`/`false`/no-op. Paths that merely *use* `..` but stay inside the
root (`a/b/../c.txt`) still resolve normally.

`StoragePathTraversalError` is exported from the package entry so callers can
catch it. `FakeAdapter` (in-memory) and `S3Adapter` (object keys, not FS paths)
are unaffected.
