import {
  Resource, Table, Form, Column,
  TextField, TextareaField, SelectField,
  SelectFilter, RelationField,
} from '@boostkit/panels'

export class DocumentResource extends Resource {
  static label = 'Documents'
  static labelSingular = 'Document'
  static icon = 'file-text'
  static navigationGroup = 'AI'

  table(table: Table) {
    return table
      .columns([
        Column.make('title').sortable().searchable(),
        Column.make('type').badge(),
        Column.make('createdAt').date().sortable(),
      ])
      .filters([
        SelectFilter.make('type')
          .label('Type')
          .options([
            { label: 'Text', value: 'text' },
            { label: 'File', value: 'file' },
            { label: 'URL',  value: 'url' },
          ]),
      ])
  }

  form(form: Form) {
    return form.fields([
      RelationField.make('knowledgeBaseId')
        .label('Knowledge Base')
        .resource('knowledge-bases')
        .displayField('name')
        .required(),

      TextField.make('title')
        .label('Title')
        .required(),

      SelectField.make('type')
        .label('Type')
        .options(['text', 'file', 'url'])
        .default('text')
        .required(),

      TextareaField.make('content')
        .label('Content')
        .rows(12),
    ])
  }
}
