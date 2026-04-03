# @rudderjs/image

Fluent image processing for RudderJS — resize, crop, convert, and optimize images. Thin wrapper over [sharp](https://sharp.pixelplumbing.com/).

## Installation

```bash
pnpm add @rudderjs/image sharp
```

`sharp` is an optional peer dependency — it must be installed separately.

## Quick Start

```ts
import { image } from '@rudderjs/image'

// Resize and convert to WebP
const buffer = await image(uploadedFile)
  .resize(800, 600)
  .format('webp')
  .quality(85)
  .toBuffer()

// Smart optimize — strip metadata, good defaults
await image(file).optimize().format('webp').toFile('output.webp')

// Lossless compression — zero quality loss
await image(file).format('webp').lossless().toBuffer()
```

## API

### `image(input)`

Create a processing pipeline. Accepts `Buffer`, file path (`string`), or `NodeJS.ReadableStream`.

### Fluent Methods

All return `this` for chaining.

| Method | Description |
|---|---|
| `resize(width?, height?)` | Resize. Omit one dimension to auto-scale by aspect ratio. |
| `crop(width?, height?)` | Shorthand for `resize().fit('cover')` — fill exact dimensions. |
| `fit(strategy)` | Fit strategy: `'cover'`, `'contain'`, `'fill'`, `'inside'`, `'outside'`. Default: `'cover'`. |
| `format(fmt)` | Output format: `'webp'`, `'jpeg'`, `'png'`, `'avif'`, `'tiff'`, `'gif'`. |
| `quality(n)` | Output quality 1–100 (lossy formats). |
| `lossless()` | Lossless compression (webp, avif, png). |
| `stripMetadata()` | Remove EXIF, ICC, and other metadata. |
| `optimize()` | Strip metadata + per-format quality defaults. |
| `rotate(degrees?)` | Rotate by degrees, or auto-rotate from EXIF. |
| `blur(sigma?)` | Gaussian blur. Default sigma: 3. |
| `grayscale()` | Convert to grayscale. |
| `conversions(specs)` | Define batch conversions. Use with `generateToStorage()`. |

### Terminal Methods

| Method | Returns | Description |
|---|---|---|
| `toBuffer()` | `Promise<Buffer>` | Processed image as a Buffer. |
| `toFile(path)` | `Promise<void>` | Write to filesystem. |
| `toStorage(disk, path)` | `Promise<void>` | Write to a storage disk. Requires `@rudderjs/storage`. |
| `toStream()` | `Promise<ReadableStream>` | Readable stream of the processed image. |
| `metadata()` | `Promise<ImageInfo>` | Image dimensions, format, size — no processing. |
| `generateToStorage(disk, dir)` | `Promise<ConversionResult[]>` | Process all conversions and write to storage. |

## Batch Conversions

Generate multiple sizes from a single source:

```ts
const results = await image(uploadedFile)
  .conversions([
    { name: 'thumb',   width: 200, height: 200, crop: true, format: 'webp' },
    { name: 'preview', width: 800, format: 'webp' },
    { name: 'og',      width: 1200, height: 630, crop: true, format: 'webp' },
  ])
  .generateToStorage('public', 'posts/42/')

// [{ name: 'thumb', path: 'posts/42/thumb.webp', width: 200, height: 200, size: 4820, format: 'webp' }, ...]
```

## Storage Integration

`toStorage()` and `generateToStorage()` use `@rudderjs/storage` to write files. Install it as an optional dependency:

```bash
pnpm add @rudderjs/storage
```

Without it, use `toBuffer()` or `toFile()` directly.

## Input Types

```ts
image(buffer)              // Buffer
image('/path/to/file.jpg') // File path
image(readableStream)      // Node.js ReadableStream
```
