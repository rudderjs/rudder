import { Global, Form, TextField, TextareaField, ToggleField, FileField, ColorField, Section } from '@boostkit/panels'

export class SiteSettingsGlobal extends Global {
  static slug  = 'site-settings'
  static label = 'Site Settings'
  static icon  = 'settings'

  form(form: Form) {
    return form.fields([
      Section.make('General').schema(
        TextField.make('siteName').required().label('Site Name'),
        TextField.make('tagline'),
        FileField.make('logo').image().accept('image/*'),
        FileField.make('favicon').image().accept('image/*'),
      ),

      Section.make('Appearance').columns(2).schema(
        ColorField.make('primaryColor').label('Primary Color'),
        ColorField.make('accentColor').label('Accent Color'),
      ),

      Section.make('SEO Defaults').collapsible().schema(
        TextField.make('metaTitle').label('Default Meta Title'),
        TextareaField.make('metaDescription').label('Default Meta Description'),
      ),

      Section.make('Maintenance').schema(
        ToggleField.make('maintenanceMode').label('Maintenance Mode'),
        TextareaField.make('maintenanceMessage').label('Maintenance Message')
          .showWhen('maintenanceMode', 'truthy'),
      ),
    ])
  }
}
