import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import type { StorageAdapter, StorageAdapterProvider } from '@boostkit/storage'

// ─── Config ────────────────────────────────────────────────

export interface S3DiskConfig {
  driver:           's3'
  bucket:           string
  region?:          string
  endpoint?:        string    // S3-compatible endpoint (MinIO, Cloudflare R2, etc.)
  accessKeyId?:     string
  secretAccessKey?: string
  baseUrl?:         string    // public base URL override
  forcePathStyle?:  boolean   // required for MinIO
}

// ─── S3 Adapter ────────────────────────────────────────────

class S3Adapter implements StorageAdapter {
  private readonly client:  S3Client
  private readonly bucket:  string
  private readonly baseUrl: string

  constructor(private readonly config: S3DiskConfig) {
    this.bucket  = config.bucket
    this.baseUrl = config.baseUrl?.replace(/\/$/, '') ?? ''

    this.client = new S3Client({
      region: config.region ?? 'us-east-1',
      ...(config.endpoint       && { endpoint:       config.endpoint }),
      ...(config.forcePathStyle && { forcePathStyle: config.forcePathStyle }),
      ...(config.accessKeyId    && {
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey ?? '' },
      }),
    })
  }

  async put(filePath: string, contents: Buffer | string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key:    filePath,
      Body:   typeof contents === 'string' ? Buffer.from(contents) : contents,
    }))
  }

  async get(filePath: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: filePath }))
      if (!res.Body) return null
      const chunks: Uint8Array[] = []
      for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk)
      return Buffer.concat(chunks)
    } catch { return null }
  }

  async text(filePath: string): Promise<string | null> {
    const buf = await this.get(filePath)
    return buf ? buf.toString('utf8') : null
  }

  async delete(filePath: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: filePath }))
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: filePath }))
      return true
    } catch { return false }
  }

  async list(directory = ''): Promise<string[]> {
    const prefix = directory ? `${directory.replace(/\/$/, '')}/` : ''
    const res = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix }))
    return (res.Contents ?? []).map(o => o.Key ?? '').filter(Boolean)
  }

  url(filePath: string): string {
    if (this.baseUrl) return `${this.baseUrl}/${filePath.replace(/^\//, '')}`
    const endpoint = this.config.endpoint?.replace(/\/$/, '')
    if (endpoint && this.config.forcePathStyle) return `${endpoint}/${this.bucket}/${filePath}`
    return `https://${this.bucket}.s3.${this.config.region ?? 'us-east-1'}.amazonaws.com/${filePath}`
  }

  path(_filePath: string): string {
    throw new Error('[BoostKit Storage] path() is not available for S3 disks.')
  }
}

// ─── Factory ───────────────────────────────────────────────

/**
 * Named export used by @boostkit/storage's dynamic import:
 *   const { s3 } = await import('@boostkit/storage-s3')
 */
export function s3(config: S3DiskConfig): StorageAdapterProvider {
  return {
    create(): StorageAdapter { return new S3Adapter(config) },
  }
}
