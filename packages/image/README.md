# @rudderjs/image

Fluent image processing for RudderJS — resize, crop, convert, optimize. Thin wrapper over [sharp](https://sharp.pixelplumbing.com/) with `@rudderjs/storage` integration and batch conversions.

## Installation

```bash
pnpm add @rudderjs/image sharp
```

`sharp` is an **optional peer dependency** — install it separately. Without it, the first call throws `[RudderJS Image] sharp is required but not installed`.

## Quick Start

```ts
import { image } from '@rudderjs/image'

// Resize and convert to WebP
const buffer = await image(uploadedFile)
  .resize(800, 600)
  .format('webp')
  .quality(85)
  .toBuffer()

// Lossless compression — zero quality loss
await image(file).format('webp').lossless().toBuffer()

// Read metadata without processing
const { width, height, format } = await image(file).metadata()
```

## Inputs

```ts
image(buffer)                  // Buffer
image('/path/to/file.jpg')     // file path (read on terminal call)
image(readableStream)          // Node.js ReadableStream
```

## Fluent Methods

All return `this` for chaining. The pipeline is lazy — nothing executes until a terminal method is called.

| Method | Description |
|---|---|
| `resize(width?, height?)` | Resize. Omit one dimension to auto-scale by aspect ratio. |
| `fit(strategy)` | Fit strategy: `'cover'`, `'contain'`, `'fill'`, `'inside'`, `'outside'`. Default: `'cover'`. |
| `crop(width?, height?)` | Shorthand for `resize(w, h).fit('cover')` — fill exact dimensions. |
| `format(fmt)` | Output format: `'webp'`, `'jpeg'`, `'png'`, `'avif'`, `'tiff'`, `'gif'`. |
| `quality(n)` | Output quality 1–100 (lossy formats). Overrides per-format defaults. |
| `lossless()` | Lossless compression (webp, avif, png). Overrides quality. |
| `stripMetadata()` | Remove EXIF, ICC, and other metadata. |
| `optimize()` | Strip metadata. Pair with `.format()` to also get format-specific quality defaults. |
| `rotate(degrees?)` | Rotate by degrees. No argument = auto-rotate from EXIF. |
| `blur(sigma?)` | Gaussian blur. Default sigma: 3. |
| `grayscale()` | Convert to grayscale. |
| `conversions(specs)` | Define batch conversions. Use with `generateToStorage()`. |

## Terminal Methods

| Method | Returns | Description |
|---|---|---|
| `toBuffer()` | `Promise<Buffer>` | Processed image as a Buffer. |
| `toFile(path)` | `Promise<void>` | Write to filesystem. |
| `toStorage(disk, path)` | `Promise<void>` | Write to a storage disk. Requires `@rudderjs/storage`. |
| `toStream()` | `Promise<ReadableStream>` | Readable stream of the processed image — use for large outputs. |
| `metadata()` | `Promise<ImageInfo>` | `{ width, height, format, size, channels, hasAlpha }` — no processing. |
| `generateToStorage(disk, dir)` | `Promise<ConversionResult[]>` | Run all `.conversions()` and write each to storage. |

## Defaults

When `.format(fmt)` is called without `.quality()`, these per-format defaults apply:

| Format | Quality | Notes |
|---|---|---|
| `webp` | 82 | Best general default for web. |
| `jpeg` | 85 | |
| `avif` | 65 | Smaller than WebP, slower encode, narrower client support. |
| `png` | 9 (compressionLevel) | Mapped from quality 1–100 → compression 0–9. |
| `tiff` | 80 | |
| `gif` | 80 | |

When neither `.format()` nor `.quality()` is set, the input format passes through unchanged. Setting `.quality()` without `.format()` falls back to JPEG.

## Common Use Cases

### Avatar resize + save to public storage

```ts
const buffer = await image(upload)
  .resize(256, 256)
  .format('webp')
  .quality(85)
  .toBuffer()

await Storage.disk('public').put(`avatars/${userId}.webp`, buffer)
// → /storage/avatars/<id>.webp
```

### Generate responsive variants in one call

```ts
const results = await image(upload)
  .conversions([
    { name: 'thumb',   width: 200, height: 200, crop: true, format: 'webp' },
    { name: 'preview', width: 800,                          format: 'webp' },
    { name: 'og',      width: 1200, height: 630, crop: true, format: 'webp' },
  ])
  .generateToStorage('public', 'posts/42/')

// [{ name: 'thumb', path: 'posts/42/thumb.webp', width: 200, height: 200, size: 4820, format: 'webp' }, ...]
```

### Phone photos: rotate before stripping metadata

```ts
await image(phonePhoto)
  .rotate()           // honor EXIF orientation FIRST
  .stripMetadata()    // then strip
  .format('webp')
  .toFile('out.webp')
```

### Large image — stream instead of buffer

```ts
const stream = await image('/uploads/8mb-tiff.tif')
  .resize(1920)
  .format('webp')
  .toStream()

stream.pipe(res)   // pipe to HTTP response
```

### Direct write to a storage disk

```ts
await image(upload)
  .resize(512, 512)
  .format('webp')
  .toStorage('s3', 'avatars/user-1.webp')
```

## Storage Integration

`toStorage()` and `generateToStorage()` use `@rudderjs/storage` to write files. Install it as an optional dependency:

```bash
pnpm add @rudderjs/storage
```

Without it, both methods throw `[RudderJS Image] toStorage() requires @rudderjs/storage`. Use `toBuffer()` or `toFile()` if you're not using the storage facade.

## Common Pitfalls

- **`sharp` not installed** — fails at first image call. `sharp` requires native binaries; environments without native module support (some edge runtimes) won't work.
- **Image processing in the request path** — encoding is CPU-bound and can take 100ms–several seconds. For uploads, dispatch to a queue job (`@rudderjs/queue`) instead of blocking the request.
- **Memory with huge inputs** — `image(buffer)` loads the whole buffer. For multi-MB sources, prefer file paths or streams. For multi-MB outputs, prefer `.toStream()` over `.toBuffer()`.
- **`.optimize()` quality defaults need `.format()`** — `.optimize()` alone only strips metadata. Per-format quality defaults are applied by `.format(fmt)`, regardless of whether `.optimize()` is called.
- **EXIF orientation flip** — phone photos have orientation metadata that displays correctly only when honored. After `stripMetadata()` the image may appear rotated. Call `.rotate()` (no args = auto from EXIF) **before** `.stripMetadata()`.
- **AVIF needs the right Sharp build** — most prebuilt Sharp binaries include AVIF, but lean builds may not. Falling back to WebP is safer for cross-environment portability.
- **Conversions reject the whole batch on one failure** — `generateToStorage()` runs all conversions in parallel via `Promise.all`. Wrap in try/catch if you need partial success.
- **`crop()` always sets `fit: 'cover'`** — calling `.fit('contain')` after `.crop()` doesn't override; `crop()` is the last word on fit.

## Key Imports

```ts
import { image } from '@rudderjs/image'
import { ImageProcessor } from '@rudderjs/image'  // class — exported for advanced use

import type {
  ImageInput,        // Buffer | string | NodeJS.ReadableStream
  ImageFormat,       // 'webp' | 'jpeg' | 'png' | 'avif' | 'tiff' | 'gif'
  FitStrategy,       // 'cover' | 'contain' | 'fill' | 'inside' | 'outside'
  ImageInfo,         // { width?, height?, format?, size?, channels?, hasAlpha? }
  ConversionSpec,    // input to .conversions([...])
  ConversionResult,  // output from .generateToStorage()
} from '@rudderjs/image'
```
