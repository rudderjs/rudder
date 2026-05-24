import app    from './app.js'
import server from './server.js'

const configs = { app, server }

export type Configs = typeof configs

export default configs
