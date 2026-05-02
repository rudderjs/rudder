# @rudderjs/image

## 1.0.0

### Major Changes

- ae3be57: Graduate to 1.0.0. The `image()` factory and `ImageProcessor` fluent API (resize, crop, fit, format, quality, lossless, stripMetadata, optimize, rotate, blur, grayscale, conversions) plus the terminal methods (toBuffer, toFile, toStream, toStorage, generateToStorage, metadata) are now part of the stable public API.

  `sharp` remains an optional peer dependency. Dogfooded in the playground via the avatar-resize demo (`/demos/avatar` → upload → 256×256 WebP via `@rudderjs/image` + `@rudderjs/storage` public disk).

  **Docs refresh:**

  - README rewritten with a Defaults table (per-format quality), Common Use Cases (avatar resize, responsive variants, EXIF rotation, streaming), and a Common Pitfalls section.
  - `.optimize()` JSDoc + README + boost guidelines now accurately describe the behavior — it strips metadata; per-format quality defaults are applied by `.format(fmt)` automatically. The previous claim that `.optimize()` applies quality defaults on its own was misleading.
  - `boost/guidelines.md` corrected: previous version showed an options-object API (`.resize({width: 800, fit: 'cover'})`, `.format('webp', {quality: 80})`) that doesn't exist. Real API uses positional args + chained `.fit()` / `.quality()`.
  - Added `Key Imports` block listing `image`, `ImageProcessor`, and the public type exports.
