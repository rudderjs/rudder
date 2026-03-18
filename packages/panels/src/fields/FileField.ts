import { Field } from '../Field.js'
import type { FieldMeta } from '../Field.js'

/** Conversion spec for auto-generating image sizes on upload. */
export interface ImageConversion {
  name:     string
  width:    number
  height?:  number
  crop?:    boolean
  format?:  'webp' | 'jpeg' | 'png' | 'avif'
  quality?: number
}

export class FileField extends Field {
  private _accept:       string  = '*/*'
  private _maxSize:      number  = 10  // MB
  private _multiple:     boolean = false
  private _disk:         string  = 'local'
  private _directory:    string  = 'uploads'
  private _image:        boolean = false
  private _optimize:     boolean = false
  private _conversions:  ImageConversion[] = []

  static make(name: string): FileField { return new FileField(name) }

  getType(): string { return this._image ? 'image' : 'file' }

  accept(mime: string): this      { this._accept    = mime; return this }
  maxSize(mb: number): this       { this._maxSize   = mb;   return this }
  multiple(): this                { this._multiple  = true; return this }
  disk(name: string): this        { this._disk      = name; return this }
  directory(path: string): this   { this._directory = path; return this }
  /** Render as image (shows preview thumbnail). */
  image(): this                   { this._image     = true; return this }

  /**
   * Auto-optimize uploaded images — strip metadata, convert to WebP, good quality defaults.
   * Requires `@boostkit/image` (optional peer).
   */
  optimize(): this { this._optimize = true; return this }

  /**
   * Generate additional image sizes on upload.
   * Each conversion is stored alongside the original using a `{name}-{convName}.{format}` naming convention.
   * Requires `@boostkit/image` (optional peer).
   *
   * @example
   * FileField.make('image')
   *   .image()
   *   .optimize()
   *   .conversions([
   *     { name: 'thumb', width: 200, height: 200, crop: true, format: 'webp' },
   *     { name: 'preview', width: 800, format: 'webp' },
   *   ])
   */
  conversions(specs: ImageConversion[]): this { this._conversions = specs; return this }

  toMeta(): FieldMeta {
    return {
      ...super.toMeta(),
      extra: {
        accept:      this._accept,
        maxSize:     this._maxSize,
        multiple:    this._multiple,
        disk:        this._disk,
        directory:   this._directory,
        image:       this._image,
        optimize:    this._optimize,
        conversions: this._conversions,
      },
    }
  }
}
