import type { Config } from 'vike/types'
import vikeReactRsc from 'vike-react-rsc-rudder/config'

// `extends: [vikeReactRsc]` makes this app a React Server Components app —
// the scanner detects the `vike-react-rsc-rudder` renderer and generates a
// server-component +Page that reads pageContext via getPageContext().
export default {
  extends:      [vikeReactRsc],
  passToClient: ['viewProps'],
} satisfies Config
