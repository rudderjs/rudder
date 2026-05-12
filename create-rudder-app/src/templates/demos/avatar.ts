// Avatar demo — image upload + resize via @rudderjs/image, persisted to the
// `public` Storage disk so the resized URL is browser-reachable.

export function demosAvatarView(): string {
  return `import { useState, useRef } from 'react'
import '@/index.css'
import { SiteHeader } from 'App/Components/SiteHeader.js'

interface ProcessedImage {
  url:    string
  format: string
  width:  number
  height: number
  size:   number
}

interface UploadResponse {
  original:  { format: string; width: number; height: number; size: number }
  processed: ProcessedImage
}

export default function AvatarResize() {
  const inputRef               = useRef<HTMLInputElement>(null)
  const [preview,  setPreview] = useState<string | null>(null)
  const [result,   setResult ] = useState<UploadResponse | null>(null)
  const [loading,  setLoading] = useState(false)
  const [error,    setError  ] = useState<string | null>(null)

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setResult(null)
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  async function upload() {
    if (!preview) return
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/avatar', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ image: preview }),
      })
      const data = await res.json() as UploadResponse | { message: string }
      if (!res.ok) throw new Error((data as { message: string }).message ?? 'Upload failed')
      setResult(data as UploadResponse)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setPreview(null); setResult(null); setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="page">
      <SiteHeader />

      <section className="hero">
        <h1 className="hero-title">Avatar Resize</h1>
        <p className="hero-lead">
          Upload any image — the server resizes it to 256×256, converts to WebP at quality 85,
          and saves to the <code className="inline-code">public</code> storage disk via{' '}
          <code className="inline-code">@rudderjs/image</code>.
        </p>
      </section>

      <section className="feature-section">
        <div className="form-card">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={onPick}
            className="form-input"
            style={{ marginBottom: '1rem' }}
          />

          {preview && !result && (
            <>
              <div style={{ marginBottom: '1rem' }}>
                <p className="form-label">Original</p>
                <img src={preview} alt="preview" style={{ maxWidth: '256px', maxHeight: '256px', borderRadius: '0.5rem', border: '1px solid var(--border, #e5e7eb)' }} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="form-submit" onClick={upload} disabled={loading} style={{ flex: 1 }}>
                  {loading ? 'Processing…' : 'Resize & upload'}
                </button>
                <button onClick={reset} disabled={loading} style={{ padding: '0.5rem 1rem', borderRadius: '0.375rem', border: '1px solid var(--border, #e5e7eb)', background: 'transparent', cursor: 'pointer' }}>
                  Reset
                </button>
              </div>
            </>
          )}

          {error && (
            <p className="form-error" style={{ marginTop: '1rem' }}>{error}</p>
          )}

          {result && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                <div>
                  <p className="form-label">Original</p>
                  {preview && (
                    <img src={preview} alt="original" style={{ maxWidth: '100%', borderRadius: '0.5rem', border: '1px solid var(--border, #e5e7eb)' }} />
                  )}
                  <p className="feature-desc" style={{ fontSize: '0.75rem' }}>
                    {result.original.format} · {result.original.width}×{result.original.height} ·{' '}
                    {(result.original.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <div>
                  <p className="form-label">Resized (WebP, 256×256)</p>
                  <img src={result.processed.url} alt="resized" style={{ maxWidth: '100%', borderRadius: '0.5rem', border: '1px solid var(--border, #e5e7eb)' }} />
                  <p className="feature-desc" style={{ fontSize: '0.75rem' }}>
                    {result.processed.format} · {result.processed.width}×{result.processed.height} ·{' '}
                    {(result.processed.size / 1024).toFixed(1)} KB ·{' '}
                    {Math.round((1 - result.processed.size / result.original.size) * 100)}% smaller
                  </p>
                </div>
              </div>
              <div style={{ marginTop: '1rem' }}>
                <button onClick={reset} style={{ padding: '0.5rem 1rem', borderRadius: '0.375rem', border: '1px solid var(--border, #e5e7eb)', background: 'transparent', cursor: 'pointer' }}>
                  Try another
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
`
}

export function demosAvatarApiBlock(): string {
  return `// POST /api/avatar — resize an uploaded image to 256x256 webp via @rudderjs/image,
// then write to the 'public' Storage disk so the URL is browser-reachable.
router.post('/api/avatar', async (req, res) => {
  const { image: dataUrl } = (req.body ?? {}) as { image?: string }
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return res.status(422).json({ message: 'Body must be { image: "data:image/...;base64,..." }' })
  }
  const base64 = dataUrl.split(',', 2)[1] ?? ''
  const input  = Buffer.from(base64, 'base64')

  const { image }   = await import('@rudderjs/image')
  const { Storage } = await import('@rudderjs/storage')

  const original = await image(input).metadata()
  const buf      = await image(input).resize(256, 256).format('webp').quality(85).toBuffer()
  const meta     = await image(buf).metadata()

  const filename = \`avatars/\${Date.now()}-\${Math.random().toString(36).slice(2, 8)}.webp\`
  await Storage.disk('public').put(filename, buf)

  res.json({
    original:  { format: original.format, width: original.width, height: original.height, size: input.length },
    processed: {
      url:    Storage.disk('public').url(filename),
      format: meta.format, width: meta.width, height: meta.height, size: buf.length,
    },
  })
})`
}
