import { ImageProcessor } from './ImageProcessor.js'
import type { ImageInput } from './types.js'

/**
 * Create an image processing pipeline.
 *
 * @example
 * ```ts
 * import { image } from '@boostkit/image'
 *
 * // Resize and convert
 * const buffer = await image(file)
 *   .resize(800, 600)
 *   .format('webp')
 *   .quality(85)
 *   .toBuffer()
 *
 * // Smart optimize (strip metadata, good defaults)
 * await image(file).optimize().format('webp').toFile('output.webp')
 *
 * // Generate multiple conversions
 * const results = await image(file)
 *   .conversions([
 *     { name: 'thumb',   width: 200, height: 200, crop: true, format: 'webp' },
 *     { name: 'preview', width: 800, format: 'webp' },
 *   ])
 *   .generateToStorage('public', 'posts/42/')
 * ```
 */
export function image(input: ImageInput): ImageProcessor {
  return new ImageProcessor(input)
}

export { ImageProcessor } from './ImageProcessor.js'

export type {
  ImageInput,
  ImageFormat,
  FitStrategy,
  ConversionSpec,
  ConversionResult,
  ImageInfo,
} from './types.js'
