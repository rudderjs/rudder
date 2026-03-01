import { artisan } from '@forge/core'
import { User } from '../app/Models/User.js'

artisan.command('inspire', () => {
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

artisan.command('db:seed', async () => {
  console.log('Seeding database...')

  await User.create({ name: 'Alice',   email: 'alice2@example.com',   role: 'admin' })
  await User.create({ name: 'Bob',     email: 'bob2@example.com',     role: 'user'  })
  await User.create({ name: 'Charlie', email: 'charlie2@example.com', role: 'user'  })

  console.log('Done. 3 users seeded.')
}).description('Seed the database with sample data')
