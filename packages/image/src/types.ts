/** Accepted input for the `image()` factory. */
export type ImageInput = Buffer | string | NodeJS.ReadableStream

/** Supported output formats. */
export type ImageFormat = 'webp' | 'jpeg' | 'png' | 'avif' | 'tiff' | 'gif'

/** Fit strategy when both width and height are specified. */
export type FitStrategy = 'cover' | 'contain' | 'fill' | 'inside' | 'outside'

/** Specification for a single conversion in a batch. */
export interface ConversionSpec {
  name:     string
  width?:   number
  height?:  number
  crop?:    boolean
  format?:  ImageFormat
  quality?: number
}

/** Result of a single conversion in a batch. */
export interface ConversionResult {
  name:   string
  path:   string
  width:  number
  height: number
  size:   number
  format: string
}

/** Image metadata (subset of sharp metadata). */
export interface ImageInfo {
  width?:    number
  height?:   number
  format?:   string
  size?:     number
  channels?: number
  hasAlpha?: boolean
}
