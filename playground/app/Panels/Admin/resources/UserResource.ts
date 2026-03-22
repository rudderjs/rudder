import { Resource, TextField, EmailField, SelectField, DateField, SelectFilter, Table, Form, Column } from '@boostkit/panels'
import { User } from '../../../Models/User.js'

export class UserResource extends Resource {
  static model = User
  static label = 'Users'
  static labelSingular = 'User'
  static icon = 'users'

  static navigationGroup      = 'System'
  static navigationBadge      = async () => await User.query().count()
  static navigationBadgeColor = 'gray' as const

  table(table: Table) {
    return table
      .columns([
        Column.make('name').sortable().searchable(),
        Column.make('email').sortable().searchable(),
        Column.make('role'),
        Column.make('createdAt').date().sortable(),
      ])
      .filters([
        SelectFilter.make('role')
          .label('Role')
          .options([
            { label: 'User',  value: 'user' },
            { label: 'Admin', value: 'admin' },
          ]),
      ])
  }

  form(form: Form) {
    return form.fields([
      TextField.make('name')
        .label('Name')
        .required()
        .searchable()
        .sortable(),

      EmailField.make('email')
        .label('Email')
        .required()
        .searchable()
        .sortable(),

      SelectField.make('role')
        .label('Role')
        .options(['user', 'admin'])
        .required(),

      DateField.make('createdAt')
        .label('Created At')
        .sortable()
        .hideFromCreate()
        .hideFromEdit()
        .readonly(),
    ])
  }
}
