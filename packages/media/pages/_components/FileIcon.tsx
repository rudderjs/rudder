interface Props {
  type: string
  mime: string | null
  className?: string
}

export function FileIcon({ type, mime, className = 'size-5' }: Props) {
  if (type === 'folder') return <FolderSvg className={className} />

  const cat = categorize(mime)
  switch (cat) {
    case 'image':       return <ImageSvg className={className} />
    case 'video':       return <VideoSvg className={className} />
    case 'audio':       return <AudioSvg className={className} />
    case 'pdf':         return <PdfSvg className={className} />
    case 'document':    return <DocSvg className={className} />
    case 'spreadsheet': return <SheetSvg className={className} />
    case 'text':        return <TextSvg className={className} />
    case 'archive':     return <ArchiveSvg className={className} />
    default:            return <FileSvg className={className} />
  }
}

function categorize(mime: string | null): string {
  if (!mime) return 'other'
  if (mime.startsWith('image/'))  return 'image'
  if (mime.startsWith('video/'))  return 'video'
  if (mime.startsWith('audio/'))  return 'audio'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.includes('wordprocessingml') || mime.includes('msword')) return 'document'
  if (mime.includes('spreadsheetml') || mime.includes('csv') || mime.includes('ms-excel')) return 'spreadsheet'
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') return 'text'
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip')) return 'archive'
  return 'other'
}

// ── SVG icons (inline, no lucide dependency) ─────────────────

const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function FolderSvg({ className }: { className: string }) {
  return <svg className={`${className} text-amber-500`} viewBox="0 0 24 24" {...s}><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
}
function ImageSvg({ className }: { className: string }) {
  return <svg className={`${className} text-green-500`} viewBox="0 0 24 24" {...s}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
}
function VideoSvg({ className }: { className: string }) {
  return <svg className={`${className} text-pink-500`} viewBox="0 0 24 24" {...s}><rect x="2" y="6" width="15" height="12" rx="2" /><path d="M17 10l5-3v10l-5-3" /></svg>
}
function AudioSvg({ className }: { className: string }) {
  return <svg className={`${className} text-yellow-500`} viewBox="0 0 24 24" {...s}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
}
function PdfSvg({ className }: { className: string }) {
  return <svg className={`${className} text-red-500`} viewBox="0 0 24 24" {...s}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M10 13H8v4h2v-1.5h.5a1.5 1.5 0 000-3H10z" /></svg>
}
function DocSvg({ className }: { className: string }) {
  return <svg className={`${className} text-blue-500`} viewBox="0 0 24 24" {...s}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>
}
function SheetSvg({ className }: { className: string }) {
  return <svg className={`${className} text-emerald-500`} viewBox="0 0 24 24" {...s}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><line x1="8" y1="13" x2="8" y2="17" /><line x1="12" y1="13" x2="12" y2="17" /><line x1="16" y1="13" x2="16" y2="17" /><line x1="8" y1="15" x2="16" y2="15" /></svg>
}
function TextSvg({ className }: { className: string }) {
  return <svg className={`${className} text-orange-400`} viewBox="0 0 24 24" {...s}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></svg>
}
function ArchiveSvg({ className }: { className: string }) {
  return <svg className={`${className} text-purple-400`} viewBox="0 0 24 24" {...s}><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></svg>
}
function FileSvg({ className }: { className: string }) {
  return <svg className={`${className} text-muted-foreground`} viewBox="0 0 24 24" {...s}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>
}
