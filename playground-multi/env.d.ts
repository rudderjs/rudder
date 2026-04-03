import type { Configs } from './config/index.js'

declare module '@rudderjs/core' {
  interface AppConfig extends Configs {}
}
