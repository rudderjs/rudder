import {
  Resource, Table, Form, Column,
  TextField, TextareaField,
} from '@boostkit/panels'

export class WorkspaceResource extends Resource {
  static label = 'Workspaces'
  static labelSingular = 'Workspace'
  static icon = 'layout-dashboard'
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
      TextField.make('name')
        .label('Name')
        .required(),

      TextareaField.make('description')
        .label('Description'),
    ])
  }
}
