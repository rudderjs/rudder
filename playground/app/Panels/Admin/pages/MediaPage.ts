import { Page, Heading, Text } from '@boostkit/panels'
import { Media } from '@boostkit/media'

export class MediaPage extends Page {
  static slug  = 'media-demo'
  static label = 'Media'
  static icon  = 'image'

  static schema() {
    return [
      Heading.make('Media Browser'),
      Text.make('Inline media browser element — browse, upload, and manage files.'),

      Media.make('Files')
        .disk('public')
        .directory('media')
        .scope('shared'),
    ]
  }
}
