import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stub } from './observer.js'

describe('make:observer — stub', () => {
  it('emits a class implementing ModelObserver from @rudderjs/orm', () => {
    const out = stub('PostObserver')
    assert.match(out, /export class PostObserver implements ModelObserver/)
    assert.match(out, /import type \{ ModelObserver \} from '@rudderjs\/orm'/)
  })

  it('scaffolds lifecycle hooks', () => {
    const out = stub('PostObserver')
    assert.match(out, /creating\(data: Record<string, unknown>\)/)
    assert.match(out, /created\(_record: Record<string, unknown>\)/)
    assert.match(out, /deleted\(_id: string \| number\)/)
  })

  it('references Model.observe registration with the class name', () => {
    assert.match(stub('VideoObserver'), /\.observe\(VideoObserver\)/)
  })
})
