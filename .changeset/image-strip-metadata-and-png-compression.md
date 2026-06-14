---
"@rudderjs/image": patch
---

Fix `stripMetadata()`/`optimize()` silently keeping metadata, and PNG default compression. The strip path called `pipeline.withMetadata(false)`, but sharp runs `keepMetadata()` before inspecting that argument, so `false` still preserves all EXIF/ICC/XMP metadata. The net effect inverted the contract: `stripMetadata()`/`optimize()` left EXIF (including GPS) on the output (a privacy leak on user uploads), while the default path silently stripped it. Metadata is now preserved only when the caller did not ask to strip, so `stripMetadata()` actually strips and the default preserves. Separately, the default PNG compression value (`9`, a 0-9 level) was fed through the quality-to-level formula `(q) * 9 / 100`, collapsing to `compressionLevel` 1 instead of 9 and producing much larger PNGs when no explicit `quality()` was set; the default is now expressed as a quality (100) that maps to level 9. Explicit `quality()` behavior is unchanged.
