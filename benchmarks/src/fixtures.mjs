// Deterministic per-size operation parameters. Every contender consumes the
// SAME fixtures, so each op does identical work across all three ORMs — the
// only variable is the ORM. (Result-parity, asserted in parity.mjs, is what
// guarantees that.)

import { SIZES, FANOUT } from './schema.mjs'

export function fixtures(size) {
  const userCount = SIZES[size]
  const postCount = userCount * FANOUT.postsPerUser
  const fixedCreatedAt = '2024-01-01T00:00:00.000Z'

  return {
    size,
    userCount,
    postCount,

    // op 3 — findByPk hot loop: rotate over a fixed window of ids so we don't
    // measure the same single page over and over, but stay deterministic.
    pkWindow: Array.from({ length: 256 }, (_, i) => 1 + (i % userCount)),

    // op 4 — small filtered list. view_count is uniform 0..5000; >4900 is ~2%.
    listThreshold: 4900,
    listLimit: 50,

    // op 5 — large hydration.
    largeLimit: 1000,

    // op 6 — nested eager load users → posts → comments (first 50 users).
    eagerUserIds: Array.from({ length: 50 }, (_, i) => 1 + i),

    // op 7 — m2m eager load posts → tags (first 200 posts).
    eagerPostIds: Array.from({ length: 200 }, (_, i) => 1 + i),

    // op 8 — aggregate / withCount for one user.
    aggUserId: Math.max(1, Math.floor(userCount / 2)),

    // op 9 — increment view_count on one post (write; runs on a scratch copy).
    incrementPostId: 1,

    // op 10 — serialize 1k hydrated rows.
    toJsonLimit: 1000,

    // op 1 — single-row insert payload.
    newUser: { name: 'Bench User', email: 'bench@insert.test', created_at: fixedCreatedAt },

    // op 2 — bulk insert payload (1k rows in one statement where supported).
    bulkRows: Array.from({ length: 1000 }, (_, i) => ({
      name: `Bulk ${i}`,
      email: `bulk${i}@insert.test`,
      created_at: fixedCreatedAt,
    })),
  }
}
