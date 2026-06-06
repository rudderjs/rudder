import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TodoInputSchema } from './TodoSchema.js'

describe('Todo', () => {
  it('validates a valid input', () => {
    const result = TodoInputSchema.safeParse({ name: 'Test' })
    assert.strictEqual(result.success, true)
  })

  it('rejects an empty name', () => {
    const result = TodoInputSchema.safeParse({ name: '' })
    assert.strictEqual(result.success, false)
  })
})
