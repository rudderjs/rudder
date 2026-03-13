export interface ContentBlockDef {
  type:  string
  label: string
  icon:  string
  group: 'text' | 'media' | 'layout'
}

/** Built-in content block definitions. */
export const contentBlockDefs: ContentBlockDef[] = [
  { type: 'paragraph', label: 'Paragraph',  icon: 'pilcrow',       group: 'text' },
  { type: 'heading',   label: 'Heading',    icon: 'heading',       group: 'text' },
  { type: 'quote',     label: 'Quote',      icon: 'quote',         group: 'text' },
  { type: 'list',      label: 'List',       icon: 'list',          group: 'text' },
  { type: 'code',      label: 'Code',       icon: 'code',          group: 'text' },
  { type: 'image',     label: 'Image',      icon: 'image',         group: 'media' },
  { type: 'table',     label: 'Table',      icon: 'table',         group: 'layout' },
  { type: 'divider',   label: 'Divider',    icon: 'minus',         group: 'layout' },
]
