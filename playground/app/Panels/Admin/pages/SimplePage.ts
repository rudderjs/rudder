import { Page, Heading, Text } from '@rudderjs/panels'

export class SimplePage extends Page {
  static slug  = 'simple-demo'
  static label = 'Simple'
  static icon  = 'image'

  static schema() {
    return [
      Heading.make('Simple Page'),
      Text.make('This is a simple page example.'),
    ]
  }
}
