import { Resource, TextField, BooleanField, DateField, NumberField, Action, SelectFilter, Table, Form, Column } from '@rudderjs/panels'
import { Todo } from '../../../Models/Todo.js'

export class TodoResource extends Resource {
  static model = Todo
  static label = 'Todos'
  static labelSingular = 'Todo'
  static icon = 'list-todo'

  table(table: Table) {
    return table
      .live()
      .columns([
        Column.make('title').sortable().searchable(),
        Column.make('completed').boolean(),
        Column.make('createdAt').date(),
        Column.make('priority').numeric(),
      ])
      .paginated('loadMore', 5)
      .remember('session')
      .filters([
        SelectFilter.make('completed')
          .label('Status')
          .options([
            { label: 'Completed',   value: true  },
            { label: 'Incomplete',  value: false },
          ]),
      ])
      .actions([
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
      ])
  }

  form(form: Form) {
    return form.fields([
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
    ])
  }
}
