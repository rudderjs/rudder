// Direct tests for the shared validation funnel (`standardValidate` /
// `standardIssuesToErrors`, exported from @rudderjs/contracts). These live here
// because @rudderjs/contracts has no test runner and the router is the funnel's
// first consumer (zod is available here). The key case is the hand-rolled
// NON-Zod validator — it proves the funnel is validator-agnostic (any
// `~standard` implementor works), not zod-coupled.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import {
  standardValidate,
  standardIssuesToErrors,
  type StandardSchemaV1,
} from '@rudderjs/contracts'

describe('standardIssuesToErrors', () => {
  it('maps a root (no-path) issue under "root"', () => {
    assert.deepEqual(
      standardIssuesToErrors([{ message: 'required' }]),
      { root: ['required'] },
    )
  })

  it('joins a nested path with "." and groups multiple messages per key', () => {
    assert.deepEqual(
      standardIssuesToErrors([
        { message: 'too short', path: ['user', 'name'] },
        { message: 'bad', path: ['user', 'name'] },
        { message: 'nope', path: ['age'] },
      ]),
      { 'user.name': ['too short', 'bad'], age: ['nope'] },
    )
  })

  it('accepts `{ key }` path segments (Standard Schema spec form)', () => {
    assert.deepEqual(
      standardIssuesToErrors([{ message: 'x', path: [{ key: 'a' }, { key: 0 }] }]),
      { 'a.0': ['x'] },
    )
  })
})

describe('standardValidate — Zod (default validator)', () => {
  it('returns the parsed value on success (coercion applied)', async () => {
    const schema = z.object({ page: z.coerce.number() })
    const result = await standardValidate(schema, { page: '3' })
    assert.deepEqual(result, { value: { page: 3 } })
  })

  it('returns the error map (per-field) on failure', async () => {
    const schema = z.object({ name: z.string(), age: z.number() })
    const result = await standardValidate(schema, { name: 1, age: 'x' })
    assert.ok(result.errors)
    assert.ok(result.errors['name'])
    assert.ok(result.errors['age'])
  })
})

describe('standardValidate — a hand-rolled NON-Zod validator (agnosticism)', () => {
  // A minimal Standard Schema validator with no Zod involved: accepts a string,
  // rejects anything else. Proves the funnel keys off `~standard`, not Zod.
  const stringSchema: StandardSchemaV1<unknown, string> = {
    '~standard': {
      version: 1,
      vendor: 'custom',
      validate: (value) =>
        typeof value === 'string'
          ? { value }
          : { issues: [{ message: 'must be a string', path: ['field'] }] },
    },
  }

  it('passes a valid value through', async () => {
    assert.deepEqual(await standardValidate(stringSchema, 'hi'), { value: 'hi' })
  })

  it('produces the same error-map shape as Zod', async () => {
    const result = await standardValidate(stringSchema, 42)
    assert.deepEqual(result, { errors: { field: ['must be a string'] } })
  })

  it('awaits an async validate()', async () => {
    const asyncSchema: StandardSchemaV1<unknown, string> = {
      '~standard': {
        version: 1,
        vendor: 'custom-async',
        validate: async (value) =>
          value === 'ok' ? { value: 'ok' } : { issues: [{ message: 'denied' }] },
      },
    }
    assert.deepEqual(await standardValidate(asyncSchema, 'ok'), { value: 'ok' })
    assert.deepEqual(await standardValidate(asyncSchema, 'no'), { errors: { root: ['denied'] } })
  })
})
