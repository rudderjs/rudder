import { Page, Heading, Text } from '@boostkit/panels'
import { Media } from '@boostkit/media'

export class MediaPage extends Page {
  static slug  = 'media-demo'
  static label = 'Media'
  static icon  = 'image'

  static schema() {
    return [
      Heading.make('Media Browser'),
      Text.make('Browse, upload, and manage files across multiple libraries.'),

      Media.make('Files')
        .library(['photos', 'documents']),
    ]
  }
}
