import { Page, Heading, Text, Form, Dialog, Section, TextField, EmailField, TextareaField, NumberField, BooleanField, SelectField } from '@boostkit/panels'
import type { PanelContext } from '@boostkit/panels'

export class FormsDemo extends Page {
  static slug  = 'forms-demo'
  static label = 'Forms Demo'
  static icon  = 'file-input'

  static async schema(_ctx: PanelContext) {
    return [
      Heading.make('Form & Dialog Examples'),
      Text.make('Demonstrates standalone forms, dialogs, sections in forms, lifecycle hooks, and initial data.'),

      // ── Simple form ────────────────────────────────────────
      Heading.make('Simple Contact Form').level(2),
      Text.make('Basic form with onSubmit handler.'),

      Form.make('contact')
        .fields([
          TextField.make('name').label('Your Name').required(),
          EmailField.make('email').label('Email Address').required(),
          TextareaField.make('message').label('Message').required(),
        ])
        .submitLabel('Send Message')
        .successMessage('Message sent! We\'ll get back to you shortly.')
        .onSubmit(async (data) => {
          console.log('[contact form]', data)
        }),

      // ── Form with sections ─────────────────────────────────
      Heading.make('Form with Sections').level(2),
      Text.make('Fields grouped into sections inside a form.'),

      Form.make('settings')
        .description('Update your preferences.')
        .method('PUT')
        .fields([
          Section.make('Profile').schema(
            TextField.make('displayName').label('Display Name').required(),
            EmailField.make('contactEmail').label('Contact Email'),
          ),
          Section.make('Preferences').columns(2).schema(
            BooleanField.make('notifications').label('Email Notifications'),
            SelectField.make('theme').label('Theme').options([
              { label: 'Light', value: 'light' },
              { label: 'Dark', value: 'dark' },
              { label: 'System', value: 'system' },
            ]),
          ),
        ])
        .submitLabel('Save Settings')
        .successMessage('Settings saved.')
        .onSubmit(async (data) => {
          console.log('[settings form]', data)
        }),

      // ── Form with initial data ─────────────────────────────
      Heading.make('Pre-populated Form').level(2),
      Text.make('Form with .data() function providing initial values.'),

      Form.make('prefilled')
        .description('This form loads with pre-filled values.')
        .data(async () => ({
          name: 'John Doe',
          email: 'john@example.com',
          bio: 'A pre-populated bio from the server.',
        }))
        .fields([
          TextField.make('name').label('Name'),
          EmailField.make('email').label('Email'),
          TextareaField.make('bio').label('Bio'),
        ])
        .submitLabel('Update')
        .successMessage('Updated.')
        .onSubmit(async (data) => {
          console.log('[prefilled form]', data)
        }),

      // ── Form with lifecycle hooks ──────────────────────────
      Heading.make('Form with Lifecycle Hooks').level(2),
      Text.make('.beforeSubmit() transforms data, .afterSubmit() runs after success.'),

      Form.make('hooks-demo')
        .fields([
          TextField.make('title').label('Title').required(),
          NumberField.make('quantity').label('Quantity'),
        ])
        .beforeSubmit(async (data) => {
          return { ...data, title: String(data.title).toUpperCase(), processedAt: new Date().toISOString() }
        })
        .afterSubmit(async (result) => {
          console.log('[hooks-demo] after submit:', result)
        })
        .submitLabel('Submit with Hooks')
        .successMessage('Processed successfully.')
        .onSubmit(async (data) => {
          console.log('[hooks-demo] received:', data)
        }),

      // ── Dialog with Form ───────────────────────────────────
      Heading.make('Dialog with Form').level(2),
      Text.make('A modal dialog wrapping a form. Click the button to open.'),

      Dialog.make('feedback-modal')
        .trigger('Open Feedback Form')
        .title('Send Feedback')
        .description('We read every submission.')
        .schema([
          Form.make('feedback')
            .fields([
              TextField.make('subject').label('Subject').required(),
              TextareaField.make('body').label('Your Feedback').required(),
              SelectField.make('rating').label('Rating').options([
                { label: '5 - Excellent', value: '5' },
                { label: '4 - Good', value: '4' },
                { label: '3 - Average', value: '3' },
                { label: '2 - Poor', value: '2' },
                { label: '1 - Terrible', value: '1' },
              ]),
            ])
            .submitLabel('Send Feedback')
            .successMessage('Thank you for your feedback!')
            .onSubmit(async (data) => {
              console.log('[feedback]', data)
            }),
        ]),
    ]
  }
}
