import app      from './app.js'
import server   from './server.js'
import database from './database.js'
import queue    from './queue.js'
import mail     from './mail.js'
import cache    from './cache.js'
import storage  from './storage.js'
import auth     from './auth.js'
import hash     from './hash.js'
import session  from './session.js'
import live     from './live.js'
import localization from './localization.js'
import media    from './media.js'
import ai       from './ai.js'
import log      from './log.js'

const configs = { app, server, database, queue, mail, cache, storage, auth, hash, session, live, localization, media, ai, log }

export type Configs = typeof configs

export default configs
