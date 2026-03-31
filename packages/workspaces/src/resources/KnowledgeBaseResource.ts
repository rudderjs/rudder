import {
  Resource, Table, Form, Column,
  TextField, TextareaField, RelationField,
} from '@boostkit/panels'

export class KnowledgeBaseResource extends Resource {
  static label = 'Knowledge Bases'
  static labelSingular = 'Knowledge Base'
  static icon = 'library'
  static navigationGroup = 'AI'

  table(table: Table) {
    return table
      .columns([
        Column.make('name').sortable().searchable(),
        Column.make('description'),
        Column.make('createdAt').date().sortable(),
      ])
  }

  form(form: Form) {
    return form.fields([
      RelationField.make('workspaceId')
        .label('Workspace')
        .resource('workspaces')
        .displayField('name')
        .required(),

      TextField.make('name')
        .label('Name')
        .required(),

      TextareaField.make('description')
        .label('Description'),
    ])
  }
}
