/** Client-side media record shape (mirrors the Prisma model). */
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
  conversions: ConversionInfo[] | string
  alt:         string | null
  meta:        Record<string, unknown>
  parentId:    string | null
  scope:       'shared' | 'private'
  userId:      string | null
  createdAt:   string
  updatedAt:   string
}

export interface ConversionInfo {
  name:     string
  filename: string
  width:    number
  height:   number
  size:     number
  format:   string
}
