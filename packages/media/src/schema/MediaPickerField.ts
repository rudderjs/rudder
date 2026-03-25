import { Field } from '@boostkit/panels'

/**
 * A form field that opens a media browser dialog to pick files.
 * Returns media record ID(s).
 *
 * @example
 * ```ts
 * MediaPickerField.make('avatar')
 *   .label('Profile Photo')
 *   .library('photos')
 *
 * MediaPickerField.make('attachments')
 *   .label('Attachments')
 *   .multiple()
 *   .library(['photos', 'documents'])
 * ```
 */
export class MediaPickerField extends Field {
  static make(name: string): MediaPickerField {
    return new MediaPickerField(name)
  }

  /** Reference one or more named media libraries defined in media() plugin config. */
  library(name: string | string[]): this {
    this._extra['library'] = Array.isArray(name) ? name : [name]
    return this
  }

  /** Allow selecting multiple files. Value becomes an array of IDs. */
  multiple(value = true): this {
    this._extra['multiple'] = value
    return this
  }

  /** Filter by accepted MIME types (overrides library accept). */
  accept(mimes: string[]): this {
    this._extra['accept'] = mimes
    return this
  }

  /** Show image preview in the field. Default: true. */
  preview(value = true): this {
    this._extra['preview'] = value
    return this
  }

  getType(): string { return 'mediaPicker' }
}
