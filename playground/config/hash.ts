import { Env } from '@rudderjs/core'
import type { HashConfig } from '@rudderjs/hash'

export default {
  driver: Env.get('HASH_DRIVER', 'bcrypt') as 'bcrypt' | 'argon2',
  bcrypt: { rounds: 12 },
  argon2: { memory: 65536, time: 3, threads: 4 },
} satisfies HashConfig
