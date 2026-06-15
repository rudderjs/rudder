import type { Readable } from 'node:stream'

// ─── Visibility ────────────────────────────────────────────

export type Visibility = 'public' | 'private'

// ─── Pre-signed URL options ────────────────────────────────

export interface TemporaryUrlOptions {
  /** Override Content-Disposition on the response (download with filename). */
  responseContentDisposition?: string
  /** Override Content-Type. */
  responseContentType?: string
  /** Custom request headers (S3: signed query params). */
  responseHeaders?: Record<string, string>
}

export interface TemporaryUploadUrlOptions {
  /**
   * Bind the upload's `Content-Type` into the signature. The client MUST send a
   * matching `Content-Type` header (returned in `headers`), so the stored object
   * can't be given an arbitrary type the app later serves as executable content.
   */
  contentType?: string
}

export interface TemporaryUploadUrl {
  url: string
  /** Headers the client MUST include on the upload request (e.g. `x-amz-acl`). */
  headers: Record<string, string>
}

// ─── Adapter Contract ──────────────────────────────────────

export interface StorageAdapter {
  /** Write a file. Creates parent directories as needed. */
  put(filePath: string, contents: Buffer | string): Promise<void>

  /** Read a file. Returns null if it doesn't exist. */
  get(filePath: string): Promise<Buffer | null>

  /** Read a file as a UTF-8 string. Returns null if it doesn't exist. */
  text(filePath: string): Promise<string | null>

  /** Delete a file. No-op if it doesn't exist. */
  delete(filePath: string): Promise<void>

  /** Check if a file exists. */
  exists(filePath: string): Promise<boolean>

  /** List files in a directory (relative paths). */
  list(directory?: string): Promise<string[]>

  /** Public URL for the file. */
  url(filePath: string): string

  /** Absolute filesystem path. Throws for remote drivers. */
  path(filePath: string): string

  // ─── v1 additions ───

  /** Issue a short-lived signed URL for downloading a file. */
  temporaryUrl(filePath: string, expiresAt: Date, opts?: TemporaryUrlOptions): Promise<string>

  /** Issue a short-lived signed URL the browser can `PUT` directly to. */
  temporaryUploadUrl(filePath: string, expiresAt: Date, opts?: TemporaryUploadUrlOptions): Promise<TemporaryUploadUrl>

  /** Set per-file visibility ('public' or 'private'). */
  setVisibility(filePath: string, visibility: Visibility): Promise<void>

  /** Read per-file visibility. Defaults to 'private' if unset. */
  getVisibility(filePath: string): Promise<Visibility>

  /** Read a file as a stream. */
  readStream(filePath: string): Promise<Readable>

  /** Pipe `stream` into `filePath`. Resolves once destination has flushed. */
  writeStream(filePath: string, stream: Readable): Promise<void>

  /** Copy `from` to `to` within the same disk. */
  copy(from: string, to: string): Promise<void>

  /** Move (rename) `from` to `to` within the same disk. */
  move(from: string, to: string): Promise<void>

  /** Append `contents` to `filePath`. Creates the file if it doesn't exist. */
  append(filePath: string, contents: string | Buffer): Promise<void>

  /** Prepend `contents` to `filePath`. Creates the file if it doesn't exist. */
  prepend(filePath: string, contents: string | Buffer): Promise<void>
}

export interface StorageAdapterProvider {
  create(): StorageAdapter | Promise<StorageAdapter>
}
