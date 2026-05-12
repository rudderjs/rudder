import type { Config } from 'vike/types'
import vikeReact from 'vike-react/config'

export default {
  extends:      [vikeReact],
  passToClient: ['user', 'locale', 'flash'],
} as unknown as Config
