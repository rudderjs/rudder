/**
 * Side-effect module — importing this file registers the Media element.
 * Used by SchemaElementRenderer to synchronously register before render.
 */
import { registerElement } from '@boostkit/panels'
import { MediaElement } from './components/MediaElement.js'

registerElement('media', MediaElement)
