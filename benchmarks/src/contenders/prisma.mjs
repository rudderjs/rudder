// ─── Contender: Prisma ───────────────────────────────────────────────────────
// PrismaClient over the better-sqlite3 driver adapter, against the same file.
// The generated client (prisma/schema.prisma → generated/prisma) only MAPS onto
// the existing tables — no `db push`, the DDL is owned by src/schema.mjs.

import { PrismaClient } from '../../generated/prisma/index.js'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PRAGMAS } from '../schema.mjs'

export const name = 'prisma'

const toUserData = (r) => ({ name: r.name, email: r.email, createdAt: r.created_at })

export async function connect(file) {
  const adapter = new PrismaBetterSqlite3({ url: `file:${file}` })
  const prisma = new PrismaClient({ adapter })
  await prisma.$connect()
  // Match the other contenders' connection pragmas where the adapter allows it.
  for (const p of PRAGMAS) {
    try {
      await prisma.$executeRawUnsafe(p)
    } catch {
      /* WAL is already set in the file; per-connection pragmas are best-effort here */
    }
  }
  return { prisma }
}

export async function disconnect(ctx) {
  await ctx.prisma.$disconnect()
}

export function build(ctx, fx) {
  const { prisma } = ctx
  let pk = 0
  let toJsonRows = null // hydrated once (during warm-up) so the timed run is pure serialization
  return {
    insertSingle: async () => {
      await prisma.user.create({ data: toUserData(fx.newUser) })
      return 1
    },
    insertBulk: async () => {
      const r = await prisma.user.createMany({ data: fx.bulkRows.map(toUserData) })
      return r.count
    },
    findByPk: async () => {
      const id = fx.pkWindow[pk++ % fx.pkWindow.length]
      const u = await prisma.user.findUnique({ where: { id } })
      return { id: u.id, name: u.name }
    },
    list: async () => {
      const rows = await prisma.post.findMany({
        where: { viewCount: { gt: fx.listThreshold } },
        orderBy: { id: 'asc' },
        take: fx.listLimit,
      })
      return rows.map((r) => r.id)
    },
    largeGet: async () => {
      const rows = await prisma.post.findMany({ orderBy: { id: 'asc' }, take: fx.largeLimit })
      return { count: rows.length, firstId: rows[0]?.id }
    },
    eagerPosts: async () => {
      const rows = await prisma.user.findMany({
        where: { id: { in: fx.eagerUserIds } },
        include: { posts: true },
      })
      let posts = 0
      for (const u of rows) posts += u.posts.length
      return posts
    },
    m2mEager: async () => {
      const rows = await prisma.post.findMany({
        where: { id: { in: fx.eagerPostIds } },
        include: { tags: { include: { tag: true } } },
      })
      let tagsN = 0
      for (const p of rows) tagsN += p.tags.length
      return tagsN
    },
    aggregate: async () => {
      const userCount = await prisma.user.count()
      const postsCount = await prisma.post.count({ where: { userId: fx.aggUserId } })
      return { userCount, postsCount }
    },
    increment: async () => {
      const r = await prisma.post.update({
        where: { id: fx.incrementPostId },
        data: { viewCount: { increment: 1 } },
      })
      return r.viewCount
    },
    toJSON: async () => {
      if (!toJsonRows) toJsonRows = await prisma.post.findMany({ orderBy: { id: 'asc' }, take: fx.toJsonLimit })
      const json = JSON.stringify(toJsonRows)
      return { rows: toJsonRows.length, bytes: json.length > 0 }
    },
  }
}

export const writeOps = new Set(['insertSingle', 'insertBulk', 'increment'])
