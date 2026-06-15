import type { Readable } from 'node:stream'
import { BaseAdapter } from '../base.js'
import type { TemporaryUrlOptions, TemporaryUploadUrl, TemporaryUploadUrlOptions, Visibility } from '../contracts.js'

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

type S3Commands = {
  GetObjectCommand:     typeof import('@aws-sdk/client-s3').GetObjectCommand
  PutObjectCommand:     typeof import('@aws-sdk/client-s3').PutObjectCommand
  DeleteObjectCommand:  typeof import('@aws-sdk/client-s3').DeleteObjectCommand
  HeadObjectCommand:    typeof import('@aws-sdk/client-s3').HeadObjectCommand
  ListObjectsV2Command: typeof import('@aws-sdk/client-s3').ListObjectsV2Command
  CopyObjectCommand:    typeof import('@aws-sdk/client-s3').CopyObjectCommand
  PutObjectAclCommand:  typeof import('@aws-sdk/client-s3').PutObjectAclCommand
  GetObjectAclCommand:  typeof import('@aws-sdk/client-s3').GetObjectAclCommand
}

interface S3GetObjectResult {
  Body?: AsyncIterable<Uint8Array> & Readable
}

interface S3ListObjectsResult {
  Contents?: Array<{ Key?: string }>
}

interface S3GetAclResult {
  Grants?: Array<{
    Grantee?: { URI?: string }
    Permission?: string
  }>
}

const ALL_USERS_URI = 'http://acs.amazonaws.com/groups/global/AllUsers'
const AUTHENTICATED_USERS_URI = 'http://acs.amazonaws.com/groups/global/AuthenticatedUsers'

/**
 * Build the S3Client config from a disk config. Explicit `credentials` are
 * attached ONLY when both accessKeyId AND secretAccessKey are non-empty —
 * otherwise the key is omitted so the AWS default credential chain (env vars,
 * instance role, SSO) applies. Pure + exported for testing.
 * @internal
 */
export function buildS3ClientConfig(config: S3DiskConfig): Record<string, unknown> {
  return {
    region: config.region ?? 'us-east-1',
    ...(config.endpoint       && { endpoint:       config.endpoint }),
    ...(config.forcePathStyle && { forcePathStyle: config.forcePathStyle }),
    ...(config.accessKeyId && config.secretAccessKey && {
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }),
  }
}

export class S3Adapter extends BaseAdapter {
  private client:  unknown
  private readonly bucket:  string
  private readonly baseUrl: string

  constructor(private readonly config: S3DiskConfig) {
    super()
    this.bucket  = config.bucket
    this.baseUrl = config.baseUrl?.replace(/\/$/, '') ?? ''
  }

  override get driverName(): string { return 's3' }

  private async getClient(): Promise<{ send: (cmd: unknown) => Promise<unknown> }> {
    if (!this.client) {
      const {
        S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand,
        ListObjectsV2Command, CopyObjectCommand, PutObjectAclCommand, GetObjectAclCommand,
      } = await import('@aws-sdk/client-s3') as typeof import('@aws-sdk/client-s3')
      this.client = new S3Client(buildS3ClientConfig(this.config))
      ;(this as unknown as { _cmds: S3Commands })._cmds = {
        GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand,
        ListObjectsV2Command, CopyObjectCommand, PutObjectAclCommand, GetObjectAclCommand,
      }
    }
    return this.client as { send: (cmd: unknown) => Promise<unknown> }
  }

  private cmds(): S3Commands { return (this as unknown as { _cmds: S3Commands })._cmds }

  // ─── Existing surface ───

  async put(filePath: string, contents: Buffer | string): Promise<void> {
    const client = await this.getClient()
    await client.send(new (this.cmds().PutObjectCommand)({
      Bucket: this.bucket, Key: filePath,
      Body: typeof contents === 'string' ? Buffer.from(contents) : contents,
    }))
  }

  async get(filePath: string): Promise<Buffer | null> {
    try {
      const client = await this.getClient()
      const res = await client.send(new (this.cmds().GetObjectCommand)({ Bucket: this.bucket, Key: filePath })) as S3GetObjectResult
      if (!res.Body) return null
      const chunks: Uint8Array[] = []
      for await (const chunk of res.Body) chunks.push(chunk)
      return Buffer.concat(chunks)
    } catch { return null }
  }

  async delete(filePath: string): Promise<void> {
    const client = await this.getClient()
    await client.send(new (this.cmds().DeleteObjectCommand)({ Bucket: this.bucket, Key: filePath }))
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      const client = await this.getClient()
      await client.send(new (this.cmds().HeadObjectCommand)({ Bucket: this.bucket, Key: filePath }))
      return true
    } catch { return false }
  }

  async list(directory = ''): Promise<string[]> {
    const prefix = directory ? `${directory.replace(/\/$/, '')}/` : ''
    const client = await this.getClient()
    const res = await client.send(new (this.cmds().ListObjectsV2Command)({ Bucket: this.bucket, Prefix: prefix })) as S3ListObjectsResult
    return (res.Contents ?? []).map(o => o.Key ?? '').filter(Boolean)
  }

  url(filePath: string): string {
    if (this.baseUrl) return `${this.baseUrl}/${filePath.replace(/^\//, '')}`
    const endpoint = this.config.endpoint?.replace(/\/$/, '')
    if (endpoint && this.config.forcePathStyle) return `${endpoint}/${this.bucket}/${filePath}`
    return `https://${this.bucket}.s3.${this.config.region ?? 'us-east-1'}.amazonaws.com/${filePath}`
  }

  path(_filePath: string): string {
    throw new Error('[RudderJS Storage] path() is not available for S3 disks.')
  }

  // ─── Visibility (S3 ACL) ───

  async setVisibility(filePath: string, visibility: Visibility): Promise<void> {
    const client = await this.getClient()
    await client.send(new (this.cmds().PutObjectAclCommand)({
      Bucket: this.bucket, Key: filePath,
      ACL: visibility === 'public' ? 'public-read' : 'private',
    }))
  }

  async getVisibility(filePath: string): Promise<Visibility> {
    const client = await this.getClient()
    const res = await client.send(new (this.cmds().GetObjectAclCommand)({
      Bucket: this.bucket, Key: filePath,
    })) as S3GetAclResult
    // A grant is "public exposure" when it targets AllUsers OR AuthenticatedUsers
    // (any authenticated AWS principal in any account — AWS itself treats this as
    // public) with READ or FULL_CONTROL (FULL_CONTROL implies READ). Matching
    // only AllUsers/READ under-reported broadly-readable objects as 'private'.
    const isPublic = (res.Grants ?? []).some(g =>
      (g.Grantee?.URI === ALL_USERS_URI || g.Grantee?.URI === AUTHENTICATED_USERS_URI) &&
      (g.Permission === 'READ' || g.Permission === 'FULL_CONTROL'),
    )
    return isPublic ? 'public' : 'private'
  }

  // ─── Streams ───

  async readStream(filePath: string): Promise<Readable> {
    const client = await this.getClient()
    const res = await client.send(new (this.cmds().GetObjectCommand)({
      Bucket: this.bucket, Key: filePath,
    })) as S3GetObjectResult
    if (!res.Body) throw new Error(`[RudderJS Storage] readStream: ${filePath} not found.`)
    return res.Body
  }

  async writeStream(filePath: string, stream: Readable): Promise<void> {
    const client = await this.getClient()
    const { Upload } = await import('@aws-sdk/lib-storage') as typeof import('@aws-sdk/lib-storage')
    await new Upload({
      client: client as never,
      params: { Bucket: this.bucket, Key: filePath, Body: stream },
    }).done()
  }

  // ─── File ops ───

  async copy(from: string, to: string): Promise<void> {
    const client = await this.getClient()
    await client.send(new (this.cmds().CopyObjectCommand)({
      Bucket: this.bucket, Key: to,
      CopySource: `${this.bucket}/${from.split('/').map(encodeURIComponent).join('/')}`,
    }))
  }

  // ─── Pre-signed URLs ───

  override async temporaryUrl(filePath: string, expiresAt: Date, opts?: TemporaryUrlOptions): Promise<string> {
    if (expiresAt.getTime() <= Date.now()) {
      throw new Error('[RudderJS Storage] temporaryUrl: expiresAt must be in the future.')
    }
    const client = await this.getClient()
    const { GetObjectCommand } = this.cmds()
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner') as typeof import('@aws-sdk/s3-request-presigner')

    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key:    filePath,
      ...(opts?.responseContentDisposition && { ResponseContentDisposition: opts.responseContentDisposition }),
      ...(opts?.responseContentType        && { ResponseContentType:        opts.responseContentType }),
    })
    const expiresIn = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
    return getSignedUrl(client as never, cmd as never, { expiresIn })
  }

  override async temporaryUploadUrl(filePath: string, expiresAt: Date, opts?: TemporaryUploadUrlOptions): Promise<TemporaryUploadUrl> {
    if (expiresAt.getTime() <= Date.now()) {
      throw new Error('[RudderJS Storage] temporaryUploadUrl: expiresAt must be in the future.')
    }
    const client = await this.getClient()
    const { PutObjectCommand } = this.cmds()
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner') as typeof import('@aws-sdk/s3-request-presigner')

    // Binding ContentType into the command makes it a SIGNED header: the upload
    // only validates if the client sends a matching Content-Type, so a holder of
    // the URL can't store arbitrary executable content under a type the app
    // later serves inline. The required header is returned so the client knows
    // what to send.
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key:    filePath,
      ...(opts?.contentType && { ContentType: opts.contentType }),
    })
    const expiresIn = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
    const url = await getSignedUrl(client as never, cmd as never, { expiresIn })
    return { url, headers: opts?.contentType ? { 'Content-Type': opts.contentType } : {} }
  }
}
