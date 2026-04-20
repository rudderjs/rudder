# @rudderjs/image

## Overview

Fluent image processing — resize, crop, convert, optimize, batch-generate multiple sizes. Thin wrapper over [sharp](https://sharp.pixelplumbing.com/), adding RudderJS-style chaining and `@rudderjs/storage` integration. Use for avatar uploads, thumbnail generation, Open Graph images, responsive image variants.

## Key Patterns

### Basic transforms

```ts
import { image } from '@rudderjs/image'

const buffer = await image(uploadedFile)
  .resize({ width: 800, height: 600, fit: 'cover' })
  .format('webp', { quality: 80 })
  .toBuffer()
```

All methods chain; terminal methods (`toBuffer`, `toFile`, `toStorage`, `toStream`) trigger execution. The chain is lazy — no processing happens until a terminal method is called.

### Inputs

```ts
image(buffer)              // Buffer
image('/path/to/file.jpg') // filesystem path
image(readableStream)      // Node.js ReadableStream
```

### Common operations

```ts
image(src)
  .resize({ width: 800 })                       // fit: 'cover' by default
  .resize({ width: 400, height: 400, crop: true })
  .rotate()                                      // auto-rotate from EXIF
  .rotate(90)                                    // manual
  .blur(3)                                        // Gaussian, sigma=3
  .grayscale()
  .stripMetadata()                               // remove EXIF/ICC/etc
  .optimize()                                    // stripMetadata + per-format quality defaults
```

### Formats

```ts
.format('webp', { quality: 80 })
.format('avif', { quality: 50 })    // smaller file, slower encode
.format('jpeg', { quality: 85 })
.format('png')
```

`webp` is the right default for most web use cases — smaller than JPEG at equivalent quality, supported everywhere except very old clients.

### Terminal methods

```ts
.toBuffer()                            // Promise<Buffer>
.toFile('./out.webp')                  // Promise<void>
.toStorage('public', 'avatars/1.webp') // Promise<void> — requires @rudderjs/storage
.toStream()                            // Promise<ReadableStream>

.metadata()                             // { width, height, format, size } — no processing
```

### Batch conversions (responsive variants)

Single source → multiple output sizes:

```ts
const results = await image(uploadedFile)
  .conversions([
    { name: 'thumb',   width: 200,  height: 200, crop: true, format: 'webp' },
    { name: 'preview', width: 800,                           format: 'webp' },
    { name: 'og',      width: 1200, height: 630, crop: true, format: 'webp' },
  ])
  .generateToStorage('public', 'posts/42/')

// [{ name: 'thumb', path: 'posts/42/thumb.webp', width, height, size, format }, ...]
```

Conversions run in parallel via `Promise.all`. One failing conversion rejects the whole batch — wrap in try/catch if you need partial success.

### Storage integration

`toStorage()` and `generateToStorage()` use `@rudderjs/storage` to write files. Install it alongside:

```bash
pnpm add @rudderjs/storage
```

Without `@rudderjs/storage` the storage methods throw at call time. Use `toBuffer()` + your own write if you're skipping storage.

## Common Pitfalls

- **`sharp` not installed.** Fails at first image call. `sharp` is a peer dependency — `pnpm add sharp`. Requires native build; if the host runtime doesn't support native modules (some edge runtimes), images won't work there.
- **Processing in request path.** Image encoding is CPU-bound and slow (100ms–several seconds for large inputs). For user uploads, dispatch to a queue job (`@rudderjs/queue`) rather than blocking the request.
- **Memory with huge inputs.** `image(buffer)` loads the whole thing. For multi-MB images, use file paths or streams.
- **`.optimize()` ambiguity.** Applies `stripMetadata()` + format-specific quality defaults. For fine-grained control, use `.stripMetadata()` + `.format(..., { quality })` explicitly.
- **EXIF orientation flip.** Phone photos often have orientation metadata that displays correctly only when the viewer honors EXIF. After stripping metadata, the image might appear rotated. Call `.rotate()` (no args = auto-rotate from EXIF) BEFORE `.stripMetadata()`.
- **Format support on older clients.** AVIF isn't universal yet (Safari < 16 doesn't support it). For web delivery, either stick to WebP or send `<picture>` with fallbacks.

## Key Imports

```ts
import { image } from '@rudderjs/image'

import type { ImageInfo, ConversionSpec, ConversionResult } from '@rudderjs/image'
```
