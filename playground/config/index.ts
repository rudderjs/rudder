import app      from './app.js'
import server   from './server.js'
import database from './database.js'
import queue    from './queue.js'
import mail     from './mail.js'
import cache    from './cache.js'
import storage  from './storage.js'
import auth     from './auth.js'
import hash     from './hash.js'
import passport from './passport.js'
import session  from './session.js'
import live     from './live.js'
import ai       from './ai.js'
import log      from './log.js'
import telescope from './telescope.js'
import pulse    from './pulse.js'
import horizon  from './horizon.js'
import localization from './localization.js'

const configs = { app, server, database, queue, mail, cache, storage, auth, hash, passport, session, live, ai, log, telescope, pulse, horizon, localization }

export type Configs = typeof configs

export default configs
