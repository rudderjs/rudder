# @rudderjs/image

## 1.2.1

### Patch Changes

- baab617: Fix `stripMetadata()`/`optimize()` silently keeping metadata, and PNG default compression. The strip path called `pipeline.withMetadata(false)`, but sharp runs `keepMetadata()` before inspecting that argument, so `false` still preserves all EXIF/ICC/XMP metadata. The net effect inverted the contract: `stripMetadata()`/`optimize()` left EXIF (including GPS) on the output (a privacy leak on user uploads), while the default path silently stripped it. Metadata is now preserved only when the caller did not ask to strip, so `stripMetadata()` actually strips and the default preserves. Separately, the default PNG compression value (`9`, a 0-9 level) was fed through the quality-to-level formula `(q) * 9 / 100`, collapsing to `compressionLevel` 1 instead of 9 and producing much larger PNGs when no explicit `quality()` was set; the default is now expressed as a quality (100) that maps to level 9. Explicit `quality()` behavior is unchanged.

## 1.2.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

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
