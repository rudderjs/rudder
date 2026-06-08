import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stub } from './cast.js'

describe('make:cast — stub', () => {
  it('emits a class implementing CastUsing from @rudderjs/orm', () => {
    const out = stub('Json')
    assert.match(out, /export class Json implements CastUsing/)
    assert.match(out, /import type \{ CastUsing \} from '@rudderjs\/orm'/)
  })

  it('scaffolds the get/set transform pair', () => {
    const out = stub('Json')
    assert.match(out, /get\(_key: string, value: unknown, _attributes: Record<string, unknown>\)/)
    assert.match(out, /set\(_key: string, value: unknown, _attributes: Record<string, unknown>\)/)
  })

  it('warns that casts must be synchronous', () => {
    assert.match(stub('Money'), /MUST be synchronous/)
  })
})
