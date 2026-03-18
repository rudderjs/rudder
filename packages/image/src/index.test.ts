import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { writeFile, unlink, readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { image, ImageProcessor } from './index.js'

// ── Helpers ──────────────────────────────────────────────────

/** Create a test image buffer of the given dimensions. */
function createTestImage(width: number, height: number, channels: 3 | 4 = 3): Buffer {
  const pixels = Buffer.alloc(width * height * channels, channels === 4 ? 0x80 : 0xff)
  return pixels
}

async function createTestPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } },
  }).png().toBuffer()
}

async function createTestJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 128, b: 255 } },
  }).jpeg().toBuffer()
}

let tmpDir: string

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'boostkit-image-test-'))
})

after(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// ─── Factory ────────────────────────────────────────────────

describe('@boostkit/image', () => {
  describe('image() factory', () => {
    it('returns an ImageProcessor instance from Buffer', async () => {
      const buf = await createTestPng(10, 10)
      assert.ok(image(buf) instanceof ImageProcessor)
    })

    it('returns an ImageProcessor instance from file path', () => {
      assert.ok(image('/nonexistent/path.jpg') instanceof ImageProcessor)
    })

    it('returns an ImageProcessor instance from ReadableStream', () => {
      const stream = Readable.from(Buffer.alloc(10))
      assert.ok(image(stream) instanceof ImageProcessor)
    })
  })

  // ─── Metadata ───────────────────────────────────────────────

  describe('metadata()', () => {
    it('returns correct dimensions and format for PNG', async () => {
      const buf = await createTestPng(100, 50)
      const info = await image(buf).metadata()
      assert.strictEqual(info.width, 100)
      assert.strictEqual(info.height, 50)
      assert.strictEqual(info.format, 'png')
    })

    it('returns correct dimensions for JPEG', async () => {
      const buf = await createTestJpeg(200, 150)
      const info = await image(buf).metadata()
      assert.strictEqual(info.width, 200)
      assert.strictEqual(info.height, 150)
      assert.strictEqual(info.format, 'jpeg')
    })

    it('reports hasAlpha for RGBA images', async () => {
      const buf = await sharp({
        create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } },
      }).png().toBuffer()
      const info = await image(buf).metadata()
      assert.strictEqual(info.hasAlpha, true)
    })
  })

  // ─── Resize ─────────────────────────────────────────────────

  describe('resize()', () => {
    it('resizes to exact dimensions with cover fit', async () => {
      const buf = await createTestPng(400, 300)
      const result = await image(buf).resize(200, 100).toBuffer()
      const info = await sharp(result).metadata()
      assert.strictEqual(info.width, 200)
      assert.strictEqual(info.height, 100)
    })

    it('resizes by width only, preserving aspect ratio', async () => {
      const buf = await createTestPng(400, 200)
      const result = await image(buf).resize(200).toBuffer()
      const info = await sharp(result).metadata()
      assert.strictEqual(info.width, 200)
      assert.strictEqual(info.height, 100)
    })

    it('resizes by height only, preserving aspect ratio', async () => {
      const buf = await createTestPng(400, 200)
      const result = await image(buf).resize(undefined, 50).toBuffer()
      const info = await sharp(result).metadata()
      assert.strictEqual(info.width, 100)
      assert.strictEqual(info.height, 50)
    })
  })

  // ─── Crop ───────────────────────────────────────────────────

  describe('crop()', () => {
    it('crops to exact dimensions', async () => {
      const buf = await createTestPng(400, 200)
      const result = await image(buf).crop(100, 100).toBuffer()
      const info = await sharp(result).metadata()
      assert.strictEqual(info.width, 100)
      assert.strictEqual(info.height, 100)
    })
  })

  // ─── Fit strategy ──────────────────────────────────────────

  describe('fit()', () => {
    it('contain fits within bounds without cropping', async () => {
      const buf = await createTestPng(400, 200)
      const result = await image(buf).resize(100, 100).fit('inside').toBuffer()
      const info = await sharp(result).metadata()
      // 400x200 inside 100x100 → 100x50
      assert.strictEqual(info.width, 100)
      assert.strictEqual(info.height, 50)
    })
  })

  // ─── Format conversion ────────────────────────────────────

  describe('format()', () => {
    it('converts PNG to WebP', async () => {
      const buf = await createTestPng(50, 50)
      const result = await image(buf).format('webp').toBuffer()
      const info = await sharp(result).metadata()
      assert.strictEqual(info.format, 'webp')
    })

    it('converts PNG to JPEG', async () => {
      const buf = await createTestPng(50, 50)
      const result = await image(buf).format('jpeg').toBuffer()
      const info = await sharp(result).metadata()
      assert.strictEqual(info.format, 'jpeg')
    })

    it('converts PNG to AVIF', async () => {
      const buf = await createTestPng(50, 50)
      const result = await image(buf).format('avif').toBuffer()
      const info = await sharp(result).metadata()
      assert.strictEqual(info.format, 'heif') // sharp reports avif as heif
    })
  })

  // ─── Quality ──────────────────────────────────────────────

  describe('quality()', () => {
    it('lower quality produces smaller file', async () => {
      const buf = await createTestJpeg(200, 200)
      const high = await image(buf).format('jpeg').quality(95).toBuffer()
      const low  = await image(buf).format('jpeg').quality(30).toBuffer()
      assert.ok(low.length < high.length, `low (${low.length}) should be smaller than high (${high.length})`)
    })

    it('clamps quality to 1-100', async () => {
      const buf = await createTestPng(10, 10)
      // Should not throw
      await image(buf).format('webp').quality(0).toBuffer()
      await image(buf).format('webp').quality(200).toBuffer()
    })
  })

  // ─── Lossless ─────────────────────────────────────────────

  describe('lossless()', () => {
    it('produces valid lossless WebP', async () => {
      const buf = await createTestPng(50, 50)
      const result = await image(buf).format('webp').lossless().toBuffer()
      const info = await sharp(result).metadata()
      assert.strictEqual(info.format, 'webp')
    })
  })

  // ─── Strip metadata ───────────────────────────────────────

  describe('stripMetadata()', () => {
    it('runs without error', async () => {
      const buf = await createTestJpeg(50, 50)
      const result = await image(buf).stripMetadata().toBuffer()
      assert.ok(Buffer.isBuffer(result))
    })
  })

  // ─── Optimize ─────────────────────────────────────────────

  describe('optimize()', () => {
    it('produces valid output', async () => {
      const buf = await createTestJpeg(100, 100)
      const result = await image(buf).optimize().format('webp').toBuffer()
      const info = await sharp(result).metadata()
      assert.strictEqual(info.format, 'webp')
    })
  })

  // ─── Grayscale ────────────────────────────────────────────

  describe('grayscale()', () => {
    it('produces valid grayscale output', async () => {
      const buf = await createTestPng(50, 50)
      const result = await image(buf).grayscale().toBuffer()
      assert.ok(Buffer.isBuffer(result))
      // Verify pixel data is grayscale by checking R=G=B on first pixel
      const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true })
      if (info.channels >= 3) {
        // All pixels should have R === G === B
        assert.strictEqual(data[0], data[1])
        assert.strictEqual(data[1], data[2])
      }
    })
  })

  // ─── Blur ─────────────────────────────────────────────────

  describe('blur()', () => {
    it('produces valid output', async () => {
      const buf = await createTestPng(50, 50)
      const result = await image(buf).blur(5).toBuffer()
      assert.ok(Buffer.isBuffer(result))
    })
  })

  // ─── Rotate ───────────────────────────────────────────────

  describe('rotate()', () => {
    it('rotates 90 degrees, swapping dimensions', async () => {
      const buf = await createTestPng(100, 50)
      const result = await image(buf).rotate(90).toBuffer()
      const info = await sharp(result).metadata()
      assert.strictEqual(info.width, 50)
      assert.strictEqual(info.height, 100)
    })
  })

  // ─── toFile ───────────────────────────────────────────────

  describe('toFile()', () => {
    it('writes processed image to disk', async () => {
      const buf = await createTestPng(100, 100)
      const outPath = join(tmpDir, 'output.webp')
      await image(buf).format('webp').toFile(outPath)
      const written = await readFile(outPath)
      const info = await sharp(written).metadata()
      assert.strictEqual(info.format, 'webp')
    })
  })

  // ─── toStream ─────────────────────────────────────────────

  describe('toStream()', () => {
    it('returns a readable stream', async () => {
      const buf = await createTestPng(50, 50)
      const stream = await image(buf).format('webp').toStream()
      const chunks: Buffer[] = []
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const result = Buffer.concat(chunks)
      const info = await sharp(result).metadata()
      assert.strictEqual(info.format, 'webp')
    })
  })

  // ─── File path input ──────────────────────────────────────

  describe('file path input', () => {
    it('reads from a file path', async () => {
      const buf = await createTestPng(80, 60)
      const inputPath = join(tmpDir, 'input.png')
      await writeFile(inputPath, buf)

      const result = await image(inputPath).resize(40, 30).toBuffer()
      const info = await sharp(result).metadata()
      assert.strictEqual(info.width, 40)
      assert.strictEqual(info.height, 30)
    })
  })

  // ─── ReadableStream input ─────────────────────────────────

  describe('ReadableStream input', () => {
    it('processes from a Node readable stream', async () => {
      const buf = await createTestPng(60, 60)
      const stream = Readable.from(buf)

      const result = await image(stream).resize(30, 30).toBuffer()
      const info = await sharp(result).metadata()
      assert.strictEqual(info.width, 30)
      assert.strictEqual(info.height, 30)
    })
  })

  // ─── Chaining ─────────────────────────────────────────────

  describe('fluent chaining', () => {
    it('all methods return the processor for chaining', async () => {
      const buf = await createTestPng(100, 100)
      const proc = image(buf)

      const result = proc
        .resize(50, 50)
        .fit('cover')
        .crop()
        .format('webp')
        .quality(80)
        .stripMetadata()
        .grayscale()
        .blur(2)

      assert.strictEqual(result, proc)
    })
  })

  // ─── Batch conversions ────────────────────────────────────

  describe('conversions() + generateToStorage()', () => {
    it('throws when no conversions are defined', async () => {
      const buf = await createTestPng(100, 100)
      await assert.rejects(
        () => image(buf).generateToStorage('public', '/tmp/test'),
        /No conversions defined/,
      )
    })
  })
})
