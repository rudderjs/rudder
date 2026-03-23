/** Format byte count to human-readable size. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** Format ISO date string to localized medium date. */
export function formatDate(d: string): string {
  try { return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(d)) }
  catch { return d }
}

/** MIME type categories for preview rendering. */
export type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'text'
  | 'archive'
  | 'other'

/** Map MIME type to a preview category. */
export function categorize(mime: string | null): FileCategory {
  if (!mime) return 'other'
  if (mime.startsWith('image/'))                                     return 'image'
  if (mime.startsWith('video/'))                                     return 'video'
  if (mime.startsWith('audio/'))                                     return 'audio'
  if (mime === 'application/pdf')                                    return 'pdf'
  if (mime.includes('wordprocessingml') || mime.includes('msword'))  return 'document'
  if (mime.includes('spreadsheetml') || mime.includes('csv') || mime.includes('ms-excel')) return 'spreadsheet'
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') return 'text'
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip') || mime.includes('rar')) return 'archive'
  return 'other'
}
