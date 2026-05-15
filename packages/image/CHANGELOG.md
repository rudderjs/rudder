# @rudderjs/image

## 1.1.1

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

## 1.1.0

### Minor Changes

- 8e682a6: Accept `Blob` and `File` as `ImageInput`

### Patch Changes

- 2f85823: Add error cause to rethrown import errors

## 1.0.1

### Patch Changes

- 95e9f4a: Include `boost/` directory in npm tarball so `guidelines://<pkg>` MCP resources are available in installed apps.

## 1.0.0

### Major Changes

- ae3be57: Graduate to 1.0.0. The `image()` factory and `ImageProcessor` fluent API (resize, crop, fit, format, quality, lossless, stripMetadata, optimize, rotate, blur, grayscale, conversions) plus the terminal methods (toBuffer, toFile, toStream, toStorage, generateToStorage, metadata) are now part of the stable public API.

  `sharp` remains an optional peer dependency. Dogfooded in the playground via the avatar-resize demo (`/demos/avatar` → upload → 256×256 WebP via `@rudderjs/image` + `@rudderjs/storage` public disk).

  **Docs refresh:**

  - README rewritten with a Defaults table (per-format quality), Common Use Cases (avatar resize, responsive variants, EXIF rotation, streaming), and a Common Pitfalls section.
  - `.optimize()` JSDoc + README + boost guidelines now accurately describe the behavior — it strips metadata; per-format quality defaults are applied by `.format(fmt)` automatically. The previous claim that `.optimize()` applies quality defaults on its own was misleading.
  - `boost/guidelines.md` corrected: previous version showed an options-object API (`.resize({width: 800, fit: 'cover'})`, `.format('webp', {quality: 80})`) that doesn't exist. Real API uses positional args + chained `.fit()` / `.quality()`.
  - Added `Key Imports` block listing `image`, `ImageProcessor`, and the public type exports.
