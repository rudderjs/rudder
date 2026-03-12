import { useState } from 'react'

interface Props {
  src: string; alt: string; caption: string
  onChange: (patch: Record<string, unknown>) => void
  uploadBase?: string; disabled?: boolean
}

export function ImageBlock({ src, alt, caption, onChange, uploadBase, disabled }: Props) {
  const [uploading, setUploading] = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !uploadBase) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('disk', 'public')
      form.append('directory', 'content')
      const res  = await fetch(`${uploadBase}/_upload`, { method: 'POST', body: form })
      const data = await res.json() as { url: string }
      onChange({ src: data.url, alt: file.name })
    } finally { setUploading(false) }
  }

  if (!src) {
    return (
      <label className="flex flex-col items-center gap-2 py-8 border-2 border-dashed rounded-lg cursor-pointer hover:bg-accent/30 transition-colors text-muted-foreground">
        <span className="text-sm">{uploading ? 'Uploading...' : 'Click to upload image'}</span>
        <input type="file" accept="image/*" onChange={handleFile} className="hidden" disabled={disabled || uploading} />
      </label>
    )
  }

  return (
    <figure className="flex flex-col gap-2">
      <img src={src} alt={alt} className="rounded-lg max-h-96 object-contain mx-auto" />
      {!disabled && (
        <input
          type="text"
          value={caption}
          onChange={(e) => onChange({ caption: e.target.value })}
          placeholder="Add a caption..."
          className="text-sm text-center text-muted-foreground bg-transparent border-none outline-none"
        />
      )}
    </figure>
  )
}
