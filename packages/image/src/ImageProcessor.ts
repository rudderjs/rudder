import type { ImageInput, ImageFormat, FitStrategy, ConversionSpec, ConversionResult, ImageInfo } from './types.js'

// ─── Lazy sharp loader ─────────────────────────────────────

type Sharp = typeof import('sharp')
let _sharp: Sharp | null = null

async function loadSharp(): Promise<Sharp> {
  if (_sharp) return _sharp
  try {
    _sharp = (await import('sharp')).default as unknown as Sharp
    return _sharp
  } catch {
    throw new Error(
      '[RudderJS Image] sharp is required but not installed.\n  Install it: pnpm add sharp',
    )
  }
}

// ─── Default quality per format ────────────────────────────

const DEFAULT_QUALITY: Record<string, number> = {
  jpeg: 85,
  webp: 82,
  avif: 65,
  png:  9, // compression level for PNG (0-9)
  tiff: 80,
  gif:  80,
}

// ─── Image Processor ───────────────────────────────────────

export class ImageProcessor {
  private _input: ImageInput
  private _width:        number | undefined
  private _height:       number | undefined
  private _fit:          FitStrategy = 'cover'
  private _format:       ImageFormat | undefined
  private _quality:      number | undefined
  private _lossless      = false
  private _stripMeta     = false
  private _rotate:       number | null | undefined // null = EXIF auto-rotate
  private _blur:         number | undefined
  private _grayscale     = false
  private _conversions:  ConversionSpec[] | undefined

  constructor(input: ImageInput) {
    this._input = input
  }

  // ── Fluent configuration ──────────────────────────────────

  /** Resize to target dimensions. Omit one to auto-scale by aspect ratio. */
  resize(width?: number, height?: number): this {
    this._width  = width
    this._height = height
    return this
  }

  /** Set fit strategy when both width and height are specified. Default: `'cover'`. */
  fit(strategy: FitStrategy): this {
    this._fit = strategy
    return this
  }

  /** Shorthand for `resize(w, h).fit('cover')` — crop to fill exact dimensions. */
  crop(width?: number, height?: number): this {
    if (width !== undefined)  this._width  = width
    if (height !== undefined) this._height = height
    this._fit = 'cover'
    return this
  }

  /** Convert to the specified format. */
  format(fmt: ImageFormat): this {
    this._format = fmt
    return this
  }

  /** Set output quality (1–100). Applies to lossy formats. */
  quality(q: number): this {
    this._quality = Math.max(1, Math.min(100, Math.round(q)))
    return this
  }

  /** Enable lossless compression (webp, avif, png). */
  lossless(): this {
    this._lossless = true
    return this
  }

  /** Strip EXIF, ICC, and other metadata. */
  stripMetadata(): this {
    this._stripMeta = true
    return this
  }

  /** Smart optimization: strip metadata + good quality defaults. */
  optimize(): this {
    this._stripMeta = true
    return this
  }

  /** Rotate by degrees, or pass no argument for EXIF auto-rotation. */
  rotate(degrees?: number): this {
    this._rotate = degrees ?? null
    return this
  }

  /** Apply Gaussian blur. Default sigma: 3. */
  blur(sigma?: number): this {
    this._blur = sigma ?? 3
    return this
  }

  /** Convert to grayscale. */
  grayscale(): this {
    this._grayscale = true
    return this
  }

  /** Define multiple conversions for batch processing. Use with `generateToStorage()`. */
  conversions(specs: ConversionSpec[]): this {
    this._conversions = specs
    return this
  }

  // ── Terminal methods ──────────────────────────────────────

  /** Process and return the result as a Buffer. */
  async toBuffer(): Promise<Buffer> {
    const pipeline = await this._buildPipeline()
    const { data } = await pipeline.toBuffer({ resolveWithObject: true })
    return data
  }

  /** Process and write to a filesystem path. */
  async toFile(outputPath: string): Promise<void> {
    const pipeline = await this._buildPipeline()
    await pipeline.toFile(outputPath)
  }

  /**
   * Process and write to a storage disk.
   * Requires `@rudderjs/storage` to be installed.
   */
  async toStorage(disk: string, filePath: string): Promise<void> {
    const buffer = await this.toBuffer()
    const { Storage } = await this._loadStorage()
    await Storage.disk(disk).put(filePath, buffer)
  }

  /** Return a Node.js readable stream of the processed image. */
  async toStream(): Promise<NodeJS.ReadableStream> {
    const pipeline = await this._buildPipeline()
    return pipeline as unknown as NodeJS.ReadableStream
  }

  /** Read image metadata without processing. */
  async metadata(): Promise<ImageInfo> {
    const sharp = await loadSharp()
    const instance = sharp(await this._resolveInput())
    const meta = await instance.metadata()
    const info: ImageInfo = {}
    if (meta.width !== undefined)    info.width    = meta.width
    if (meta.height !== undefined)   info.height   = meta.height
    if (meta.format !== undefined)   info.format   = meta.format
    if (meta.size !== undefined)     info.size     = meta.size
    if (meta.channels !== undefined) info.channels = meta.channels
    if (meta.hasAlpha !== undefined) info.hasAlpha = meta.hasAlpha
    return info
  }

  /**
   * Process all defined conversions and write to a storage disk.
   * Files are saved as `{directory}/{name}.{format}`.
   *
   * Requires `@rudderjs/storage` and `.conversions()` to be set.
   */
  async generateToStorage(disk: string, directory: string): Promise<ConversionResult[]> {
    if (!this._conversions?.length) {
      throw new Error('[RudderJS Image] No conversions defined. Call .conversions([...]) first.')
    }

    const { Storage } = await this._loadStorage()
    const inputBuffer = await this._resolveInput()
    const sharp = await loadSharp()
    const results: ConversionResult[] = []

    await Promise.all(this._conversions.map(async (spec) => {
      const processor = new ImageProcessor(inputBuffer)
      if (spec.width || spec.height) processor.resize(spec.width, spec.height)
      if (spec.crop) processor._fit = 'cover'
      if (spec.format) processor.format(spec.format)
      if (spec.quality) processor.quality(spec.quality)
      processor.stripMetadata()

      const buffer = await processor.toBuffer()
      const info   = await sharp(buffer).metadata()
      const ext    = spec.format ?? info.format ?? 'jpg'
      const path   = directory.replace(/\/$/, '') + '/' + spec.name + '.' + ext

      await Storage.disk(disk).put(path, buffer)

      results.push({
        name:   spec.name,
        path,
        width:  info.width ?? 0,
        height: info.height ?? 0,
        size:   buffer.length,
        format: ext,
      })
    }))

    return results
  }

  // ── Internal ──────────────────────────────────────────────

  private async _resolveInput(): Promise<Buffer> {
    if (Buffer.isBuffer(this._input)) return this._input
    if (typeof this._input === 'string') {
      const { readFile } = await import('node:fs/promises')
      return readFile(this._input)
    }
    // ReadableStream → Buffer
    const chunks: Buffer[] = []
    for await (const chunk of this._input as AsyncIterable<Buffer>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _buildPipeline(): Promise<any> {
    const sharp = await loadSharp()
    const input = await this._resolveInput()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pipeline: any = sharp(input)

    // Auto-rotate or explicit rotation
    if (this._rotate === null) {
      pipeline = pipeline.rotate()
    } else if (this._rotate !== undefined) {
      pipeline = pipeline.rotate(this._rotate)
    }

    // Resize
    if (this._width || this._height) {
      pipeline = pipeline.resize(this._width, this._height, { fit: this._fit })
    }

    // Grayscale
    if (this._grayscale) {
      pipeline = pipeline.grayscale()
    }

    // Blur
    if (this._blur) {
      pipeline = pipeline.blur(this._blur)
    }

    // Strip metadata
    if (this._stripMeta) {
      pipeline = pipeline.withMetadata(false) // sharp: false strips metadata
    }

    // Format + quality
    const fmt = this._format
    if (fmt) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const opts: Record<string, any> = {}
      if (this._lossless) {
        opts['lossless'] = true
      } else {
        const q = this._quality ?? DEFAULT_QUALITY[fmt]
        if (fmt === 'png') {
          opts['compressionLevel'] = Math.round((q ?? 9) * 9 / 100)
        } else if (q !== undefined) {
          opts['quality'] = q
        }
      }
      pipeline = pipeline.toFormat(fmt, opts)
    } else if (this._quality) {
      // Quality set without explicit format — apply to the input format
      pipeline = pipeline.jpeg({ quality: this._quality })
    }

    return pipeline
  }

  private async _loadStorage(): Promise<{ Storage: { disk(name: string): { put(path: string, contents: Buffer | string): Promise<void> } } }> {
    try {
      return await import('@rudderjs/storage') as { Storage: { disk(name: string): { put(path: string, contents: Buffer | string): Promise<void> } } }
    } catch {
      throw new Error(
        '[RudderJS Image] toStorage() requires @rudderjs/storage.\n  Install it: pnpm add @rudderjs/storage',
      )
    }
  }
}
