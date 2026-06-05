// Per-instance serialization visibility controls (audit §2 — untested public
// surface): makeVisible / makeHidden / setVisible / setHidden / mergeVisible /
// mergeHidden. All are instance-level overrides layered over the static
// `hidden` / `visible` lists; none may mutate the statics or leak to sibling
// instances.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Model } from './index.js'

class User extends Model {
  static override hidden = ['password']
  name = 'Alice'
  email = 'alice@example.com'
  password = 'secret'
}

class Profile extends Model {
  static override visible = ['name']
  name = 'Bob'
  bio = 'hidden by visible-list'
}

describe('makeVisible()', () => {
  it('re-exposes a statically hidden field for this instance only', () => {
    const u = new User().makeVisible('password')
    assert.equal(u.toJSON()['password'], 'secret')
    // A sibling instance still hides it.
    assert.ok(!('password' in new User().toJSON()))
    // The static list is untouched.
    assert.deepEqual(User.hidden, ['password'])
  })

  it('accepts an array and returns this for chaining', () => {
    class Locked extends Model {
      static override hidden = ['a', 'b']
      a = 1; b = 2; c = 3
    }
    const m = new Locked()
    assert.equal(m.makeVisible(['a', 'b']), m)
    assert.deepEqual(Object.keys(m.toJSON()).sort(), ['a', 'b', 'c'])
  })
})

describe('makeHidden()', () => {
  it('hides an extra field on top of the static hidden list', () => {
    const u = new User().makeHidden('email')
    const json = u.toJSON()
    assert.ok(!('email' in json))
    assert.ok(!('password' in json), 'static hidden still applies')
    assert.ok('name' in json)
    assert.ok('email' in new User().toJSON(), 'sibling instances unaffected')
  })
})

describe('setVisible()', () => {
  it('replaces the visible list — only listed keys serialize', () => {
    const u = new User().setVisible(['name'])
    assert.deepEqual(Object.keys(u.toJSON()), ['name'])
  })

  it('overrides the static visible list for this instance only', () => {
    const p = new Profile().setVisible(['bio'])
    assert.deepEqual(Object.keys(p.toJSON()), ['bio'])
    assert.deepEqual(Object.keys(new Profile().toJSON()), ['name'])
    assert.deepEqual(Profile.visible, ['name'])
  })
})

describe('setHidden()', () => {
  it('replaces the hidden list — a statically hidden key not in the new list reappears', () => {
    const u = new User().setHidden(['email'])
    const json = u.toJSON()
    assert.ok(!('email' in json))
    assert.equal(json['password'], 'secret', 'replacement dropped the static hidden entry')
  })
})

describe('mergeVisible()', () => {
  it('unions with the static visible list', () => {
    const p = new Profile().mergeVisible(['bio'])
    assert.deepEqual(Object.keys(p.toJSON()).sort(), ['bio', 'name'])
    assert.deepEqual(Profile.visible, ['name'], 'static list untouched')
  })
})

describe('mergeHidden()', () => {
  it('unions with the static hidden list', () => {
    const u = new User().mergeHidden(['email'])
    const json = u.toJSON()
    assert.ok(!('password' in json), 'static entry kept')
    assert.ok(!('email' in json), 'merged entry applied')
    assert.deepEqual(Object.keys(json), ['name'])
    assert.deepEqual(User.hidden, ['password'], 'static list untouched')
  })

  it('stacks with an earlier per-instance override', () => {
    const u = new User().setHidden(['email']).mergeHidden(['name'])
    assert.deepEqual(Object.keys(u.toJSON()).sort(), ['password'])
  })
})
