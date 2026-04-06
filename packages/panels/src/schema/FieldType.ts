/**
 * All known field type identifiers used by the panels package.
 * Use these constants instead of magic strings.
 */
export const FieldType = {
  Text:          'text',
  Email:         'email',
  Number:        'number',
  Select:        'select',
  MultiSelect:   'multiselect',
  Boolean:       'boolean',
  Date:          'date',
  DateTime:      'datetime',
  Textarea:      'textarea',
  BelongsTo:     'belongsTo',
  BelongsToMany: 'belongsToMany',
  HasMany:       'hasMany',
  Password:      'password',
  Slug:          'slug',
  Tags:          'tags',
  Hidden:        'hidden',
  Toggle:        'toggle',
  Color:         'color',
  Json:          'json',
  Repeater:      'repeater',
  Builder:       'builder',
  File:          'file',
  Image:         'image',
  Computed:      'computed',
  RichContent:   'richcontent',
  Content:       'content',
} as const

export type FieldTypeValue = typeof FieldType[keyof typeof FieldType]
