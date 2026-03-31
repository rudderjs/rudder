import {
  Resource, Table, Form, Column, Section,
  TextField, TextareaField, SelectField, NumberField,
  BooleanField, JsonField, SelectFilter, RelationField,
} from '@boostkit/panels'

export class AgentResource extends Resource {
  static label = 'Agents'
  static labelSingular = 'Agent'
  static icon = 'bot'
  static navigationGroup = 'AI'

  table(table: Table) {
    return table
      .columns([
        Column.make('name').sortable().searchable(),
        Column.make('role'),
        Column.make('model'),
        Column.make('active').boolean(),
        Column.make('createdAt').date().sortable(),
      ])
      .filters([
        SelectFilter.make('active')
          .label('Status')
          .options([
            { label: 'Active',   value: 'true' },
            { label: 'Inactive', value: 'false' },
          ]),
      ])
  }

  form(form: Form) {
    return form.fields([
      Section.make('General').schema(
        RelationField.make('departmentId')
          .label('Department')
          .resource('departments')
          .displayField('name')
          .required(),

        TextField.make('name')
          .label('Name')
          .required(),

        TextField.make('role')
          .label('Role'),

        BooleanField.make('active')
          .label('Active')
          .default(true),
      ),

      Section.make('Model Configuration').schema(
        SelectField.make('model')
          .label('Model')
          .options([
            { label: 'Claude Sonnet 4.5',   value: 'anthropic/claude-sonnet-4-5' },
            { label: 'Claude Haiku 4.5',    value: 'anthropic/claude-haiku-4-5' },
            { label: 'GPT-4o',              value: 'openai/gpt-4o' },
            { label: 'GPT-4o Mini',         value: 'openai/gpt-4o-mini' },
            { label: 'Gemini 2.5 Pro',      value: 'google/gemini-2.5-pro' },
            { label: 'Gemini 2.5 Flash',    value: 'google/gemini-2.5-flash' },
          ])
          .searchable(),

        NumberField.make('temperature')
          .label('Temperature')
          .min(0)
          .max(2)
          .step(0.1),

        NumberField.make('maxTokens')
          .label('Max Tokens'),
      ),

      Section.make('Instructions').schema(
        TextareaField.make('systemPrompt')
          .label('System Prompt')
          .rows(10),
      ),

      Section.make('Advanced').collapsible().schema(
        JsonField.make('tools')
          .label('Tools Configuration'),

        JsonField.make('failover')
          .label('Failover Models'),
      ),
    ])
  }
}
