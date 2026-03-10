import { Field } from '../Field.js'
import type { FieldMeta } from '../Field.js'

export class FileField extends Field {
  private _accept:    string  = '*/*'
  private _maxSize:   number  = 10  // MB
  private _multiple:  boolean = false
  private _disk:      string  = 'local'
  private _directory: string  = 'uploads'
  private _image:     boolean = false

  static make(name: string): FileField { return new FileField(name) }

  getType(): string { return this._image ? 'image' : 'file' }

  accept(mime: string): this      { this._accept    = mime; return this }
  maxSize(mb: number): this       { this._maxSize   = mb;   return this }
  multiple(): this                { this._multiple  = true; return this }
  disk(name: string): this        { this._disk      = name; return this }
  directory(path: string): this   { this._directory = path; return this }
  /** Render as image (shows preview thumbnail). */
  image(): this                   { this._image     = true; return this }

  toMeta(): FieldMeta {
    return {
      ...super.toMeta(),
      extra: {
        accept:    this._accept,
        maxSize:   this._maxSize,
        multiple:  this._multiple,
        disk:      this._disk,
        directory: this._directory,
        image:     this._image,
      },
    }
  }
}
