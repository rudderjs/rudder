---
"@rudderjs/storage": patch
---

fix: contain LocalAdapter paths within the disk root (path traversal)

`LocalAdapter` derived every filesystem path with `path.join(this.root, filePath)`
and did nothing to stop `..` segments from escaping the configured disk root. An
app that passed untrusted input — an upload filename, a user-supplied storage key
— to `storage().put()/get()/delete()/copy()/move()/…` could read or write outside
the disk (e.g. `put('../../etc/cron.d/x', …)`).

`abs()` (and the visibility sidecar resolver) now route through a containment
check that throws a new `StoragePathTraversalError` when the joined path climbs
above the root, matching Laravel's behaviour of keeping every operation within
the disk. The check runs before the defensive `try/catch` in `get`/`exists`/
`delete`/`list`/`getVisibility`, so an escaping path fails loudly instead of
being swallowed into a `null`/`false`/no-op. Paths that merely *use* `..` but
stay inside the root (`a/b/../c.txt`) still resolve normally, and an absolute
path is neutralised (joined relative to the root, never honoured as-is) — which
also closes the Windows drive/UNC-override variant.

`StoragePathTraversalError` is exported from the package entry so callers can
catch it. `FakeAdapter` (in-memory) and `S3Adapter` (object keys, not FS paths)
are unaffected.
