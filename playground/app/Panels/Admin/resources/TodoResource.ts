import { Resource, TextField, BooleanField, DateField, NumberField, Action, SelectFilter } from '@boostkit/panels'
import { Todo } from '../../../Models/Todo.js'

export class TodoResource extends Resource {
  static model = Todo
  static label = 'Todos'
  static labelSingular = 'Todo'
  static icon = 'check-square'

  fields() {
    return [
      TextField.make('title')
        .label('Title')
        .required()
        .searchable()
        .sortable(),

      BooleanField.make('completed')
        .label('Completed'),

      DateField.make('createdAt')
        .label('Created At')
        .hideFromCreate()
        .hideFromEdit()
        .readonly(),

      NumberField.make('priority').label('Priority').component('rating'),
    ]
  }

  filters() {
    return [
      SelectFilter.make('completed')
        .label('Status')
        .options([
          { label: 'Completed',   value: '1' },
          { label: 'Incomplete',  value: '0' },
        ]),
    ]
  }

  actions() {
    return [
      Action.make('markComplete')
        .label('Mark as Complete')
        .icon('check')
        .bulk()
        .handler(async (records) => {
          for (const record of records as Todo[]) {
            await Todo.query().update(record.id, { completed: true })
          }
        }),

      Action.make('delete')
        .label('Delete Selected')
        .icon('trash')
        .destructive()
        .confirm('Are you sure you want to delete the selected todos?')
        .bulk()
        .handler(async (records) => {
          for (const record of records as Todo[]) {
            await Todo.query().delete(record.id)
          }
        }),
    ]
  }
}
