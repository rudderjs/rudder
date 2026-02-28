import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@forge/core'
import { hono } from '@forge/server-hono'
import { router } from '@forge/router'
import configs from '../config/index.ts'
import { providers } from './providers.ts'
import '../routes/api.ts'

export const server = hono()

export const app = Application.create({
  name:      configs.app.name,
  env:       configs.app.env,
  debug:     configs.app.debug,
  config:    configs,
  providers,
})

export const handleFetch = await server.createFetchHandler((adapter) => {
  router.mount(adapter)
})
