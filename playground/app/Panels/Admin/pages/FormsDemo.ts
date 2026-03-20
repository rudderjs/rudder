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
      Section.make('Simple Contact Form')
        .description('Basic form with onSubmit handler.')
        .schema(
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
        ),

      // ── Form with sections ─────────────────────────────────
      Section.make('Form with Sections')
        .description('Fields grouped into sections inside a form.')
        .schema(
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
        ),

      // ── Form with initial data ─────────────────────────────
      Section.make('Pre-populated Form')
        .description('Form with .data() function providing initial values.')
        .schema(
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
        ),

      // ── Form with lifecycle hooks ──────────────────────────
      Section.make('Form with Lifecycle Hooks')
        .description('.beforeSubmit() transforms data, .afterSubmit() runs after success.')
        .schema(
          Form.make('hooks-demo')
            .fields([
              TextField.make('title').label('Title').required(),
              NumberField.make('quantity').label('Quantity'),
            ])
            .beforeSubmit(async (data) => {
              // Transform data before submission
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
        ),

      // ── Dialog with Form ───────────────────────────────────
      Section.make('Dialog with Form')
        .description('A modal dialog wrapping a form. Click the button to open.')
        .schema(
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
        ),
    ]
  }
}
