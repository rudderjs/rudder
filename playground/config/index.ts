import app      from './app.js'
import server   from './server.js'
import database from './database.js'
import queue    from './queue.js'
import mail     from './mail.js'
import cache    from './cache.js'
import storage  from './storage.js'
import auth     from './auth.js'
import session  from './session.js'
import live     from './live.js'
import localization from './localization.js'

const configs = { app, server, database, queue, mail, cache, storage, auth, session, live, localization }

export type Configs = typeof configs

export default configs
