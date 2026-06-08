import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stub } from './policy.js'

describe('make:policy — stub', () => {
  it('emits a class extending Policy from @rudderjs/auth', () => {
    const out = stub('PostPolicy')
    assert.match(out, /export class PostPolicy extends Policy/)
    assert.match(out, /from '@rudderjs\/auth'/)
  })

  it('includes ability methods typed against Authenticatable', () => {
    const out = stub('PostPolicy')
    assert.match(out, /viewAny\(_user: Authenticatable\)/)
    assert.match(out, /update\(_user: Authenticatable, _model: unknown\)/)
  })

  it('references Gate.policy registration with the class name', () => {
    assert.match(stub('OrderPolicy'), /Gate\.policy\(Post, OrderPolicy\)/)
  })
})
