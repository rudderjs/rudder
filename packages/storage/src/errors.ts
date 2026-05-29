/**
 * Thrown when a storage adapter is asked to do something it can't.
 *
 * Examples:
 * - `LocalAdapter.temporaryUploadUrl` (no signed-POST equivalent in v1).
 * - `S3Adapter.path` (no local filesystem path).
 */
export class StorageNotSupportedError extends Error {
  constructor(driver: string, op: string) {
    super(`[RudderJS Storage] ${driver} adapter does not support "${op}". See docs/storage.md for alternatives.`)
    this.name = 'StorageNotSupportedError'
  }
}

/**
 * Thrown when a path passed to a storage operation resolves outside the disk
 * root — e.g. `storage().put('../../etc/passwd', …)`. Guards against directory
 * traversal when a file path is derived from untrusted input (upload names,
 * user-supplied keys). The disk root is the containment boundary, matching
 * Laravel's behaviour of keeping every operation within the configured disk.
 */
export class StoragePathTraversalError extends Error {
  constructor(filePath: string) {
    super(`[RudderJS Storage] path "${filePath}" resolves outside the disk root and was rejected.`)
    this.name = 'StoragePathTraversalError'
  }
}
