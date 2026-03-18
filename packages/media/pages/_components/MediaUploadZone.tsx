'use client'

interface Props {
  uploading: boolean
}

export function MediaUploadZone({ uploading }: Props) {
  if (!uploading) return null

  return (
    <div className="flex items-center gap-3 px-5 py-2 bg-primary/5 border-b text-sm">
      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-muted-foreground">Uploading files...</span>
    </div>
  )
}
