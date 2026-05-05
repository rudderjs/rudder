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
