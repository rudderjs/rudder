// The operation matrix + contender registry, shared by parity.mjs and run.mjs.
// `write: true` ops mutate, so the runner/parity gate hands them a fresh scratch
// copy of the seed DB; read ops run against the untouched seed file.

import * as rudder from './rudder.mjs'
import * as drizzle from './drizzle.mjs'
import * as prisma from './prisma.mjs'

export const CONTENDERS = [rudder, drizzle, prisma]

export const OPS = [
  { id: 'insertSingle', label: 'insert single row', write: true },
  { id: 'insertBulk', label: 'insert bulk (1k rows)', write: true },
  { id: 'findByPk', label: 'findByPk (hot loop)', write: false },
  { id: 'list', label: 'where + order + limit 50', write: false },
  { id: 'largeGet', label: 'where get 1k rows (hydration)', write: false },
  { id: 'eagerPosts', label: 'eager-load posts (50 users)', write: false },
  { id: 'm2mEager', label: 'eager-load tags via pivot (200 posts)', write: false },
  { id: 'aggregate', label: 'count + filtered count', write: false },
  { id: 'increment', label: 'increment view_count', write: true },
  { id: 'toJSON', label: 'serialize 1k hydrated rows', write: false },
]
