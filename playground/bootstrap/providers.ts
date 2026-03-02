import type { Application, ServiceProvider } from '@forge/core'
import { betterAuth } from '@forge/auth-better-auth'
import { queue } from '@forge/queue'
import { DatabaseServiceProvider } from '../app/Providers/DatabaseServiceProvider.js'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'
import { TodoServiceProvider } from '../app/Modules/Todo/TodoServiceProvider.js'
import configs from '../config/index.js'

export default [
  DatabaseServiceProvider,  // must boot first — sets up ModelRegistry
  betterAuth(configs.auth),
  queue(configs.queue),
  AppServiceProvider,
  TodoServiceProvider,
] satisfies (new (app: Application) => ServiceProvider)[]
