import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { arg } from './prune.js'

describe('model:prune arg parser', () => {
  it('--name=value form', () => {
    assert.equal(arg(['--chunk=200'], '--chunk'), '200')
  })

  it('--name value form', () => {
    assert.equal(arg(['--chunk', '500'], '--chunk'), '500')
  })

  it('returns undefined when flag is absent', () => {
    assert.equal(arg(['--pretend'], '--chunk'), undefined)
  })

  it('= form takes precedence when both shapes appear', () => {
    assert.equal(arg(['--chunk=10', '--chunk', '99'], '--chunk'), '10')
  })

  it('returns undefined when --name is the last arg with no value', () => {
    assert.equal(arg(['--model'], '--model'), undefined)
  })
})
