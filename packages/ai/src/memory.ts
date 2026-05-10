import type {
  MemoryEntry,
  RemembersOverride,
  RemembersSpec,
  UserMemory,
} from './types.js'

function generateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * In-process, Map-backed {@link UserMemory}. Ships in the runtime-agnostic
 * main entry — same pattern as {@link MemoryConversationStore}. Suitable
 * for tests and dev; production apps configure an ORM- or
 * embedding-backed store via `AiConfig.memory`.
 *
 * `recall()` uses case-insensitive substring matching against `fact +
 * tags`. Matches return in insertion order with no scoring (a binary
 * yes/no). Tag filters apply before the substring match — they intersect
 * with the entry's own tags.
 */
export class MemoryUserMemory implements UserMemory {
  private readonly entries = new Map<string, MemoryEntry>()

  async remember(
    userId: string,
    fact:   string,
    opts?:  { tags?: string[]; score?: number },
  ): Promise<MemoryEntry> {
    const entry: MemoryEntry = {
      id:        generateId(),
      userId,
      fact,
      createdAt: new Date(),
      ...(opts?.tags  !== undefined ? { tags:  opts.tags  } : {}),
      ...(opts?.score !== undefined ? { score: opts.score } : {}),
    }
    this.entries.set(entry.id, entry)
    return entry
  }

  async recall(
    userId: string,
    query:  string,
    opts?:  { limit?: number; tags?: string[] },
  ): Promise<MemoryEntry[]> {
    const needle  = query.toLowerCase()
    const wanted  = opts?.tags
    const matches = this.allForUser(userId)
      .filter(e => matchesTags(e, wanted))
      .filter(e => {
        const haystack = `${e.fact} ${(e.tags ?? []).join(' ')}`.toLowerCase()
        return haystack.includes(needle)
      })
    return capLimit(matches, opts?.limit)
  }

  async forget(userId: string, factId: string): Promise<void> {
    const entry = this.entries.get(factId)
    if (entry && entry.userId === userId) this.entries.delete(factId)
  }

  async list(
    userId: string,
    opts?:  { tags?: string[]; limit?: number },
  ): Promise<MemoryEntry[]> {
    const wanted  = opts?.tags
    const matches = this.allForUser(userId).filter(e => matchesTags(e, wanted))
    return capLimit(matches, opts?.limit)
  }

  async forgetAll(userId: string): Promise<void> {
    for (const [id, entry] of this.entries) {
      if (entry.userId === userId) this.entries.delete(id)
    }
  }

  private allForUser(userId: string): MemoryEntry[] {
    const out: MemoryEntry[] = []
    for (const entry of this.entries.values()) {
      if (entry.userId === userId) out.push(entry)
    }
    return out
  }
}

function matchesTags(entry: MemoryEntry, wanted: string[] | undefined): boolean {
  if (!wanted || wanted.length === 0) return true
  if (!entry.tags || entry.tags.length === 0) return false
  return wanted.every(t => entry.tags!.includes(t))
}

function capLimit<T>(items: T[], limit: number | undefined): T[] {
  return limit !== undefined && limit > 0 ? items.slice(0, limit) : items
}

/**
 * Resolves the effective {@link RemembersSpec} for a single
 * `prompt()` / `stream()` call. Returns `null` when memory should be
 * skipped for this call.
 *
 * Precedence (high → low):
 * 1. Per-call `options.memory` — `false` opts out, a spec replaces the
 *    agent's declaration.
 * 2. Agent's `remembers()` — supports sync OR async returns.
 *
 * Mirrors {@link resolveAutoPersistSpec} so Phase 2's auto-inject
 * middleware can drop in alongside the conversation-persistence flow.
 */
export async function resolveRemembersSpec(
  agentDecl: () => false | RemembersSpec | Promise<false | RemembersSpec>,
  perCall:   RemembersOverride | undefined,
): Promise<RemembersSpec | null> {
  if (perCall === false) return null
  if (perCall && typeof perCall === 'object') {
    if (!perCall.user) return null
    return perCall
  }

  const declared = await agentDecl()
  if (declared === false || !declared) return null
  if (!declared.user) return null
  return declared
}

/**
 * Lookup signature used by Phase 2/3 middleware to find the registered
 * {@link UserMemory} without taking a hard dep on `agent.ts`. Wired to
 * `setUserMemory()` / `AiProvider`'s `ai.memory` DI binding.
 */
export type UserMemoryLookup = () => UserMemory | null | undefined
