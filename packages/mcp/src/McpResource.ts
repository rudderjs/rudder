import { getDescription } from './decorators.js'

export abstract class McpResource {
  /** Resource URI pattern */
  abstract uri(): string

  /** MIME type */
  mimeType(): string {
    return 'text/plain'
  }

  /** Resource description */
  description(): string {
    return getDescription(this.constructor) ?? ''
  }

  /** Handle resource read */
  abstract handle(): Promise<string>
}
