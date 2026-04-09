import { Page, Heading, Text, Dialog, Form, TextField, EmailField, TextareaField, SelectField, NumberField, Stats, Stat, List } from '@pilotiq/panels'
import type { PanelContext } from '@pilotiq/panels'

export class DialogsDemo extends Page {
  static slug  = 'dialogs-demo'
  static label = 'Dialogs Demo'
  static icon  = 'square-stack'

  static async schema(_ctx: PanelContext) {
    return [
      Heading.make('Dialog Examples'),
      Text.make('Demonstrates modal dialogs with forms, content, and nested elements.'),

      // ── Simple dialog with form ────────────────────────────
      Heading.make('Dialog with Contact Form').level(2),
      Text.make('Click the button to open a modal with a form inside.'),

      Dialog.make('contact-dialog')
        .trigger('Contact Support')
        .title('Send a Message')
        .description('We\'ll get back to you within 24 hours.')
        .schema([
          Form.make('contact-form')
            .fields([
              TextField.make('name').label('Your Name').required(),
              EmailField.make('email').label('Email Address').required(),
              TextareaField.make('message').label('Message').required(),
            ])
            .submitLabel('Send Message')
            .successMessage('Message sent!')
            .onSubmit(async (data) => {
              console.log('[contact form]', data)
            }),
        ]),

      // ── Dialog with feedback form ──────────────────────────
      Heading.make('Feedback Dialog').level(2),
      Text.make('A more complex form with a select field.'),

      Dialog.make('feedback-dialog')
        .trigger('Give Feedback')
        .title('How are we doing?')
        .description('Your feedback helps us improve.')
        .schema([
          Form.make('feedback-form')
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
            .submitLabel('Submit Feedback')
            .successMessage('Thank you for your feedback!')
            .onSubmit(async (data) => {
              console.log('[feedback]', data)
            }),
        ]),

      // ── Dialog with static content ─────────────────────────
      Heading.make('Dialog with Content').level(2),
      Text.make('A dialog can contain any schema elements, not just forms.'),

      Dialog.make('info-dialog')
        .trigger('View Details')
        .title('System Information')
        .schema([
          Stats.make([
            Stat.make('Uptime').value('99.9%'),
            Stat.make('Response Time').value('45ms'),
            Stat.make('Active Users').value(128),
          ]),
          List.make('Recent Events')
            .items([
              { label: 'Deployment completed', description: '2 hours ago', icon: '🚀' },
              { label: 'Database backup', description: '6 hours ago', icon: '💾' },
              { label: 'SSL renewed', description: '1 day ago', icon: '🔒' },
            ]),
        ]),

      // ── Multiple dialogs ───────────────────────────────────
      Heading.make('Multiple Dialogs').level(2),
      Text.make('Multiple dialogs on the same page, each independent.'),

      Dialog.make('quick-add')
        .trigger('Quick Add Item')
        .title('Add New Item')
        .schema([
          Form.make('quick-add-form')
            .fields([
              TextField.make('title').label('Title').required(),
              NumberField.make('quantity').label('Quantity'),
            ])
            .submitLabel('Add')
            .successMessage('Item added!')
            .onSubmit(async (data) => {
              console.log('[quick add]', data)
            }),
        ]),

      Dialog.make('settings-dialog')
        .trigger('Open Settings')
        .title('Quick Settings')
        .description('Adjust your preferences.')
        .schema([
          Form.make('settings-form')
            .fields([
              SelectField.make('theme').label('Theme').options([
                { label: 'Light', value: 'light' },
                { label: 'Dark', value: 'dark' },
                { label: 'System', value: 'system' },
              ]),
              SelectField.make('language').label('Language').options([
                { label: 'English', value: 'en' },
                { label: 'Arabic', value: 'ar' },
              ]),
            ])
            .submitLabel('Save')
            .successMessage('Settings saved.')
            .onSubmit(async (data) => {
              console.log('[settings]', data)
            }),
        ]),
    ]
  }
}
