import { Resource, TextField, EmailField, SelectField, DateField, SelectFilter } from '@boostkit/panels'
import { User } from '../../../Models/User.js'

export class UserResource extends Resource {
  static model = User
  static label = 'Users'
  static labelSingular = 'User'
  static icon = 'users'

  fields() {
    return [
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
    ]
  }

  filters() {
    return [
      SelectFilter.make('role')
        .label('Role')
        .options([
          { label: 'User',  value: 'user' },
          { label: 'Admin', value: 'admin' },
        ]),
    ]
  }
}
