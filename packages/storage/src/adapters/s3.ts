import type { Readable } from 'node:stream'
import { BaseAdapter } from '../base.js'
import type { TemporaryUrlOptions, TemporaryUploadUrl, Visibility } from '../contracts.js'

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
      this.client = new S3Client({
        region: this.config.region ?? 'us-east-1',
        ...(this.config.endpoint       && { endpoint:       this.config.endpoint }),
        ...(this.config.forcePathStyle && { forcePathStyle: this.config.forcePathStyle }),
        ...(this.config.accessKeyId    && {
          credentials: { accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey ?? '' },
        }),
      })
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
    const isPublic = (res.Grants ?? []).some(g =>
      g.Grantee?.URI === ALL_USERS_URI && g.Permission === 'READ',
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

  override async temporaryUploadUrl(filePath: string, expiresAt: Date): Promise<TemporaryUploadUrl> {
    if (expiresAt.getTime() <= Date.now()) {
      throw new Error('[RudderJS Storage] temporaryUploadUrl: expiresAt must be in the future.')
    }
    const client = await this.getClient()
    const { PutObjectCommand } = this.cmds()
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner') as typeof import('@aws-sdk/s3-request-presigner')

    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: filePath })
    const expiresIn = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
    const url = await getSignedUrl(client as never, cmd as never, { expiresIn })
    return { url, headers: {} }
  }
}
