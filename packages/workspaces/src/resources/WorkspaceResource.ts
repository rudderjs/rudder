import {
  Resource, Table, Form, Column,
  TextField, TextareaField,
} from '@boostkit/panels'
import { Workspace } from '../models/Workspace.js'
import { Canvas } from '../canvas/Canvas.js'
import { Chat } from '../chat/Chat.js'

export class WorkspaceResource extends Resource {
  static model = Workspace
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

  detail(_record?: Record<string, unknown>) {
    return [
      Canvas.make('workspace')
        .editable()
        .collaborative()
        .persist(),

      Chat.make('workspace-chat')
        .collaborative()
        .persist()
        .height(400),
    ]
  }
}
