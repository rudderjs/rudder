import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePath } from './path-template.js'

test('plain param', () => {
  assert.deepEqual(parsePath('/users/:id'), {
    template: '/users/{id}',
    params: [{ name: 'id', integer: false }],
  })
})

test('whereNumber pattern flags integer', () => {
  assert.deepEqual(parsePath('/users/:id{[0-9]+}'), {
    template: '/users/{id}',
    params: [{ name: 'id', integer: true }],
  })
})

test('multiple params', () => {
  assert.deepEqual(parsePath('/orgs/:org/users/:user'), {
    template: '/orgs/{org}/users/{user}',
    params: [{ name: 'org', integer: false }, { name: 'user', integer: false }],
  })
})

test('optional param renders required template, non-integer non-number pattern', () => {
  const r = parsePath('/files/:name?{[A-Za-z]+}')
  assert.equal(r.template, '/files/{name}')
  assert.deepEqual(r.params, [{ name: 'name', integer: false }])
})

test('nested-brace pattern parses without breaking', () => {
  // a fixed-width number constraint: 8 digits
  const r = parsePath('/codes/:code{[0-9]{8}}')
  assert.equal(r.template, '/codes/{code}')
  assert.deepEqual(r.params, [{ name: 'code', integer: false }])
})

test('no params', () => {
  assert.deepEqual(parsePath('/health'), { template: '/health', params: [] })
})
