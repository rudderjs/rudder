import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import {
  convertSchema,
  registerSchemaConverter,
  getSchemaConverter,
  schemaVendor,
  type SchemaConverter,
} from './index.js'

describe('schemaVendor', () => {
  it('reads the ~standard vendor tag off a zod schema', () => {
    assert.equal(schemaVendor(z.object({ a: z.string() })), 'zod')
  })
  it('returns undefined for a non-standard-schema value', () => {
    assert.equal(schemaVendor({}), undefined)
    assert.equal(schemaVendor(null), undefined)
  })
})

describe('convertSchema — zod default converter', () => {
  it('converts an object schema to JSON Schema', () => {
    const json = convertSchema(z.object({ name: z.string(), age: z.number() }), 'input')
    assert.ok(json)
    assert.equal(json!['type'], 'object')
    const props = json!['properties'] as Record<string, unknown>
    assert.deepEqual((props['name'] as Record<string, unknown>)['type'], 'string')
    assert.deepEqual((props['age'] as Record<string, unknown>)['type'], 'number')
    assert.deepEqual(json!['required'], ['name', 'age'])
  })

  it('omits an optional field from required', () => {
    const json = convertSchema(z.object({ a: z.string(), b: z.string().optional() }), 'input')!
    assert.deepEqual(json['required'], ['a'])
  })

  it('strips the top-level $schema dialect marker', () => {
    const json = convertSchema(z.object({ a: z.string() }), 'input')!
    assert.ok(!('$schema' in json))
  })

  it('degrades z.date() to an open schema instead of throwing (unrepresentable: any)', () => {
    // Should not throw, and should produce *something*.
    const json = convertSchema(z.object({ when: z.date() }), 'input')
    assert.ok(json)
  })
})

describe('registry dispatch', () => {
  it('returns null when the schema has no ~standard tag', () => {
    assert.equal(convertSchema({ not: 'a schema' }), null)
  })

  it('returns null when no converter is registered for the vendor', () => {
    const fakeValibot = { '~standard': { version: 1, vendor: 'valibot', validate: () => ({ value: 1 }) } }
    assert.equal(convertSchema(fakeValibot), null)
  })

  it('a registered custom-vendor converter is dispatched to', () => {
    const conv: SchemaConverter = () => ({ type: 'string', 'x-custom': true })
    registerSchemaConverter('custom-vendor', conv)
    assert.equal(getSchemaConverter('custom-vendor'), conv)
    const fake = { '~standard': { version: 1, vendor: 'custom-vendor', validate: () => ({ value: 1 }) } }
    assert.deepEqual(convertSchema(fake), { type: 'string', 'x-custom': true })
  })

  it('last writer wins (apps can override a vendor)', () => {
    const first: SchemaConverter = () => ({ a: 1 })
    const second: SchemaConverter = () => ({ b: 2 })
    registerSchemaConverter('override-me', first)
    registerSchemaConverter('override-me', second)
    assert.equal(getSchemaConverter('override-me'), second)
  })
})
