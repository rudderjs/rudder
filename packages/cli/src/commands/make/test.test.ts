import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { _internal } from './test.js'

const { featureStub, unitStub, stripTestSuffix, pickStub } = _internal

// ── stripTestSuffix ───────────────────────────────────────────

describe('make:test — stripTestSuffix', () => {
  it('drops a trailing .test', () => {
    assert.equal(stripTestSuffix('User.test'), 'User')
  })

  it('leaves names without .test unchanged', () => {
    assert.equal(stripTestSuffix('User'),     'User')
    assert.equal(stripTestSuffix('Tester'),   'Tester')
    assert.equal(stripTestSuffix('test'),     'test')
  })

  it('only strips the trailing occurrence', () => {
    assert.equal(stripTestSuffix('test.User.test'), 'test.User')
  })
})

// ── featureStub ───────────────────────────────────────────────

describe('make:test — featureStub', () => {
  it('emits a TestCase-based test with the describe label set to the name', () => {
    const out = featureStub('User')
    assert.match(out, /import .* from 'node:test'/)
    assert.match(out, /import \{ AppTestCase \} from '\.\/TestCase\.js'/)
    assert.match(out, /describe\('User',/)
    assert.match(out, /AppTestCase\.create\(\)/)
    assert.match(out, /await t\.teardown\(\)/)
    assert.match(out, /res\.assertOk\(\)/)
  })

  it('does NOT import node:assert (TestResponse covers assertions)', () => {
    const out = featureStub('User')
    assert.doesNotMatch(out, /from 'node:assert/)
  })
})

// ── unitStub ──────────────────────────────────────────────────

describe('make:test — unitStub', () => {
  it('emits a plain node:test file with node:assert', () => {
    const out = unitStub('Math')
    assert.match(out, /import \{ describe, it \} from 'node:test'/)
    assert.match(out, /import assert from 'node:assert\/strict'/)
    assert.match(out, /describe\('Math',/)
    assert.match(out, /assert\.equal\(/)
  })

  it('does NOT pull in AppTestCase', () => {
    const out = unitStub('Math')
    assert.doesNotMatch(out, /AppTestCase/)
    assert.doesNotMatch(out, /@rudderjs\/testing/)
  })
})

// ── pickStub ──────────────────────────────────────────────────

describe('make:test — pickStub', () => {
  it('defaults to the feature stub', () => {
    assert.match(pickStub('User', {}), /AppTestCase\.create\(\)/)
  })

  it('uses the unit stub when --unit is passed', () => {
    assert.match(pickStub('Math', { unit: true }), /import assert from 'node:assert\/strict'/)
  })

  it('strips the .test suffix from the describe label', () => {
    // The MakeSpec uses `suffix: '.test'` so the className arriving here may
    // already have it. The describe label should still read "User", not
    // "User.test".
    assert.match(pickStub('User.test', {}), /describe\('User',/)
    assert.match(pickStub('Math.test', { unit: true }), /describe\('Math',/)
  })
})
