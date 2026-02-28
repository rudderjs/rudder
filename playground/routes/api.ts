import { router } from '@forge/router'
import { resolve } from '@forge/core'
import { UserService } from '../app/Services/UserService.js'

router.get('/api/health', (req, res) => res.json({ status: 'ok' }))

router.get('/api/users', async (req, res) => {
  const users = await resolve(UserService).findAll()
  return res.json({ data: users })
})
