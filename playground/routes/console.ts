import { Artisan } from '@boostkit/artisan'
import { Schedule } from '@boostkit/core'
import { Cache } from '@boostkit/cache'
import { User } from '../app/Models/User.js'
import { SendEmails } from '../app/Commands/SendEmails.js'

// Class-based commands (Laravel-style)
Artisan.register(SendEmails)

Artisan.command('inspire', () => {
  const quotes = [
    'The best way to predict the future is to create it.',
    'Build something people want.',
    'Stay hungry, stay foolish.',
    'Code is poetry.',
    'Simplicity is the soul of efficiency.',
  ]
  const quote = quotes[Math.floor(Math.random() * quotes.length)]!
  console.log(`\n  "${quote}"\n`)
}).description('Display an inspiring quote')

Artisan.command('db:seed', async () => {
  console.log('Seeding database...')

  await User.create({ name: 'Alice',   email: 'alice2@example.com',   role: 'admin' })
  await User.create({ name: 'Bob',     email: 'bob2@example.com',     role: 'user'  })
  await User.create({ name: 'Charlie', email: 'charlie2@example.com', role: 'user'  })

  console.log('Done. 3 users seeded.')
}).description('Seed the database with sample data')

// ─── Scheduled Tasks ───────────────────────────────────────

// Flush the users query cache every 5 minutes so stale data doesn't linger
Schedule.call(async () => {
  await Cache.forget('users:all')
}).everyFiveMinutes().description('Flush users:all cache')

// Log a heartbeat every minute (useful for confirming the scheduler is alive)
Schedule.call(() => {
  console.log('[Heartbeat] Scheduler is running —', new Date().toISOString())
}).everySecond().description('Heartbeat log')
