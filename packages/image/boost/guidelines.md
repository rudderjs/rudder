# @rudderjs/image

## Overview

Fluent image processing — resize, crop, convert, optimize, batch-generate multiple sizes. Thin wrapper over [sharp](https://sharp.pixelplumbing.com/), adding RudderJS-style chaining and `@rudderjs/storage` integration. Use for avatar uploads, thumbnail generation, Open Graph images, responsive image variants.

## Key Patterns

### Basic transforms

```ts
import { image } from '@rudderjs/image'

const buffer = await image(uploadedFile)
  .resize(800, 600)
  .fit('cover')
  .format('webp')
  .quality(85)
  .toBuffer()
```

All methods chain; terminal methods (`toBuffer`, `toFile`, `toStorage`, `toStream`) trigger execution. The chain is lazy — no processing happens until a terminal method is called.

### Inputs

```ts
image(buffer)              // Buffer
image('/path/to/file.jpg') // filesystem path (read on terminal call)
image(readableStream)      // Node.js ReadableStream
```

### Resize, crop, fit

```ts
image(src).resize(800)                 // width only — height auto-scales by aspect ratio
image(src).resize(800, 600)            // both — default fit is 'cover'
image(src).resize(800, 600).fit('contain')
image(src).crop(400, 400)              // shorthand for resize(400, 400).fit('cover')
```

### Common operations

```ts
image(src)
  .rotate()                  // auto-rotate from EXIF (call BEFORE stripMetadata)
  .rotate(90)                // manual rotation in degrees
  .blur(3)                   // Gaussian blur, sigma=3
  .grayscale()
  .stripMetadata()           // remove EXIF/ICC
  .optimize()                // alias for stripMetadata; per-format quality defaults apply via .format()
```

### Formats

```ts
.format('webp').quality(80)     // explicit quality
.format('webp')                 // implicit quality 82 (per-format default)
.format('avif')                 // implicit quality 65; smaller file, slower encode
.format('jpeg').quality(85)
.format('png')                  // quality maps to compressionLevel 0–9
.format('webp').lossless()      // lossless overrides quality
```

`webp` is the right default for most web use — smaller than JPEG at equivalent quality, supported everywhere except very old clients.

### Per-format default quality

When `.format(fmt)` is called without `.quality()`, these defaults apply:

| Format | Default |
|---|---|
| webp | 82 |
| jpeg | 85 |
| avif | 65 |
| png | compressionLevel 9 (mapped from quality 100) |
| tiff | 80 |
| gif | 80 |

Setting `.quality()` without `.format()` falls back to JPEG.

### Terminal methods

```ts
.toBuffer()                            // Promise<Buffer>
.toFile('./out.webp')                  // Promise<void>
.toStorage('public', 'avatars/1.webp') // Promise<void> — requires @rudderjs/storage
.toStream()                            // Promise<ReadableStream> — use for large outputs

.metadata()                             // { width?, height?, format?, size?, channels?, hasAlpha? } — no processing
```

### Batch conversions (responsive variants)

Single source → multiple output sizes in parallel:

```ts
const results = await image(uploadedFile)
  .conversions([
    { name: 'thumb',   width: 200,  height: 200, crop: true, format: 'webp' },
    { name: 'preview', width: 800,                           format: 'webp' },
    { name: 'og',      width: 1200, height: 630, crop: true, format: 'webp' },
  ])
  .generateToStorage('public', 'posts/42/')

// [{ name: 'thumb', path: 'posts/42/thumb.webp', width: 200, height: 200, size: 4820, format: 'webp' }, ...]
```

Conversions run in parallel via `Promise.all`. One failing conversion rejects the whole batch — wrap in try/catch if you need partial success.

### Storage integration

`toStorage()` and `generateToStorage()` use `@rudderjs/storage` to write files. Install it alongside:

```bash
pnpm add @rudderjs/storage
```

Without `@rudderjs/storage`, those methods throw `[RudderJS Image] toStorage() requires @rudderjs/storage`. Use `toBuffer()` + your own writer if you're skipping storage.

## Common Pitfalls

- **`sharp` not installed.** Fails at first image call. `sharp` is a peer dep — `pnpm add sharp`. Requires native build; runtimes without native module support (some edge runtimes) can't use it.
- **`.optimize()` only strips metadata.** Per-format quality defaults come from `.format(fmt)`, not `.optimize()`. The two compose: call `.optimize().format('webp')` for both.
- **Image processing in request path.** Encoding is CPU-bound (100ms–several seconds for large inputs). For user uploads, dispatch to a queue job (`@rudderjs/queue`) rather than blocking the request.
- **Memory with huge inputs.** `image(buffer)` loads the whole thing into memory. For multi-MB sources, prefer file paths or streams. For multi-MB outputs, prefer `.toStream()` over `.toBuffer()`.
- **EXIF orientation flip.** Phone photos have orientation metadata that displays correctly only when honored. After `.stripMetadata()` the image might appear rotated. Call `.rotate()` (no args) BEFORE `.stripMetadata()`.
- **`.crop()` is the last word on fit.** `crop()` always sets `fit: 'cover'`. Calling `.fit('contain')` after `.crop()` doesn't override.
- **AVIF support varies.** Not all Sharp builds include AVIF. Falling back to WebP is safer for portability across environments. Also, AVIF isn't supported on Safari < 16 — for browser delivery use `<picture>` with WebP fallback.

## Key Imports

```ts
import { image, ImageProcessor } from '@rudderjs/image'

import type {
  ImageInput,
  ImageFormat,
  FitStrategy,
  ImageInfo,
  ConversionSpec,
  ConversionResult,
} from '@rudderjs/image'
```
