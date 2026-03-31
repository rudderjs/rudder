import {
  Resource, Table, Form, Column,
  TextField, TextareaField, ColorField, NumberField,
  RelationField,
} from '@boostkit/panels'

export class DepartmentResource extends Resource {
  static label = 'Departments'
  static labelSingular = 'Department'
  static icon = 'building-2'
  static navigationGroup = 'AI'

  table(table: Table) {
    return table
      .columns([
        Column.make('name').sortable().searchable(),
        Column.make('color').badge(),
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

      ColorField.make('color')
        .label('Color')
        .default('#3b82f6'),

      TextareaField.make('instructions')
        .label('Domain Instructions')
        .rows(6),

      NumberField.make('sortOrder')
        .label('Sort Order')
        .default(0),
    ])
  }
}
