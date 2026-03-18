/** A media record as returned from the database. */
export interface MediaRecord {
  id:          string
  name:        string
  type:        'file' | 'folder'
  mime:        string | null
  size:        number | null
  disk:        string
  directory:   string
  filename:    string
  width:       number | null
  height:      number | null
  focalX:      number | null
  focalY:      number | null
  conversions: ConversionInfo[]
  alt:         string | null
  meta:        Record<string, unknown>
  parentId:    string | null
  scope:       'shared' | 'private'
  userId:      string | null
  createdAt:   Date | string
  updatedAt:   Date | string
}

/** Stored conversion info (persisted in the conversions JSON column). */
export interface ConversionInfo {
  name:     string
  filename: string
  width:    number
  height:   number
  size:     number
  format:   string
}

/** Configuration for a media conversion. */
export interface MediaConversion {
  name:    string
  width:   number
  height?: number
  crop?:   boolean
  format?: 'webp' | 'jpeg' | 'png' | 'avif'
  quality?: number
}

/** Media library configuration. */
export interface MediaConfig {
  /** Storage disk for media files. Default: 'public'. */
  disk?: string
  /** Base directory within the disk. Default: 'media'. */
  directory?: string
  /** Max upload size in bytes. Default: 10MB. */
  maxUploadSize?: number
  /** Default conversions generated for every image upload. */
  conversions?: MediaConversion[]
  /** Accepted MIME types. Default: all. */
  acceptedMimes?: string[]
}

/** Data shape passed to the media browser page (SSR). */
export interface MediaPageData {
  panelPath:    string
  currentFolder: MediaRecord | null
  items:        MediaRecord[]
  breadcrumbs:  Array<{ id: string; name: string }>
  scope:        'shared' | 'private'
  userId:       string | null
}

/** MIME type categories for preview rendering. */
export type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'   // docx
  | 'spreadsheet' // xlsx, csv
  | 'text'        // txt, md, json, xml, code
  | 'archive'     // zip, tar, gz
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
