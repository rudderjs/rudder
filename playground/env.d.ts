import type { Configs } from './config/index.js'

declare module '@boostkit/core' {
  interface AppConfig extends Configs {}
}
