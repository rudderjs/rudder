import { Page, Heading, Text, Table, Column, SelectField, TextareaField } from '@rudderjs/panels'
import type { PanelContext } from '@rudderjs/panels'

export class InlineEditDemo extends Page {
  static slug  = 'inline-edit-demo'
  static label = 'Inline Edit'
  static icon  = 'pencil'

  static async schema(_ctx: PanelContext) {
    return [
      Heading.make('Inline Edit Demo'),
      Text.make('All three edit modes demonstrated: inline (default), popover, and modal.'),

      // ── Inline mode (default) ──
      Heading.make('Inline Mode').level(2),
      Text.make('Text, select, and toggle fields edit directly in the cell. Click a value to start editing.'),

      Table.make('Inline Mode Demo')
        .fromArray([
          { id: 1, name: 'Project Alpha', priority: 'high', progress: 75, enabled: true },
          { id: 2, name: 'Project Beta', priority: 'medium', progress: 30, enabled: false },
          { id: 3, name: 'Project Gamma', priority: 'low', progress: 100, enabled: true },
        ])
        .columns([
          Column.make('name').label('Name').editable(),
          Column.make('priority').label('Priority').editable(
            SelectField.make('priority').options([
              { label: 'High', value: 'high' },
              { label: 'Medium', value: 'medium' },
              { label: 'Low', value: 'low' },
            ]),
          ),
          Column.make('progress').label('Progress').numeric().editable(),
          Column.make('enabled').label('Enabled').boolean().editable(),
        ])
        .onSave(async (record, field, value) => {
          console.log('[inline]', { id: record['id'], field, value })
        }),

      // ── Popover mode ──
      Heading.make('Popover Mode').level(2),
      Text.make('Click a cell to open a popover with a full field input. Good for textarea, tags, and other multi-line fields.'),

      Table.make('Popover Mode Demo')
        .fromArray([
          { id: 1, title: 'Meeting Notes', notes: 'Discussed roadmap for Q3. Key decisions: migrate to new infra.' },
          { id: 2, title: 'Bug Report', notes: 'Login page crashes on Safari when using biometric auth.' },
          { id: 3, title: 'Feature Request', notes: 'Add dark mode support for the admin panel.' },
        ])
        .columns([
          Column.make('title').label('Title').editable(),
          Column.make('notes').label('Notes').editable(TextareaField.make('notes'), 'popover'),
        ])
        .onSave(async (record, field, value) => {
          console.log('[popover]', { id: record['id'], field, value })
        }),

      // ── Modal mode ──
      Heading.make('Modal Mode').level(2),
      Text.make('Click a cell to open a dialog with the field editor. Best for complex or large fields.'),

      Table.make('Modal Mode Demo')
        .fromArray([
          { id: 1, title: 'Welcome Email', body: 'Dear user,\n\nWelcome to our platform! We are excited to have you on board.\n\nBest regards,\nThe Team' },
          { id: 2, title: 'Password Reset', body: 'Hi,\n\nYou requested a password reset. Click the link below to set a new password.\n\nIf you did not request this, please ignore this email.' },
        ])
        .columns([
          Column.make('title').label('Title').editable(),
          Column.make('body').label('Body').editable(TextareaField.make('body'), 'modal'),
        ])
        .onSave(async (record, field, value) => {
          console.log('[modal]', { id: record['id'], field, value })
        }),
    ]
  }
}
