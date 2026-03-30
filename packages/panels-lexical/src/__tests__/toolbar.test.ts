import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveToolbar, hasTool, hasHeadingTool } from '../toolbar.js'
import type { ToolbarProfile, ToolbarTool } from '../toolbar.js'

describe('resolveToolbar', () => {
  it('returns default profile when no input', () => {
    const config = resolveToolbar()
    assert.equal(config.profile, 'default')
    assert.equal(config.fixed, false)
    assert.ok(config.tools.includes('bold'))
    assert.ok(config.tools.includes('italic'))
    assert.ok(config.tools.includes('link'))
  })

  it('returns default profile for undefined input', () => {
    const config = resolveToolbar(undefined)
    assert.equal(config.profile, 'default')
  })

  it('resolves document profile with fixed toolbar', () => {
    const config = resolveToolbar('document')
    assert.equal(config.profile, 'document')
    assert.equal(config.fixed, true)
    assert.ok(config.tools.includes('undo'))
    assert.ok(config.tools.includes('redo'))
    assert.ok(config.tools.includes('heading'))
    assert.ok(config.tools.includes('bold'))
    assert.ok(config.tools.includes('align'))
    assert.ok(config.tools.includes('bulletList'))
    assert.ok(config.tools.includes('blockquote'))
    assert.ok(config.tools.includes('divider'))
  })

  it('resolves simple profile', () => {
    const config = resolveToolbar('simple')
    assert.equal(config.profile, 'simple')
    assert.equal(config.fixed, false)
    assert.ok(config.tools.includes('bold'))
    assert.ok(config.tools.includes('italic'))
    assert.ok(config.tools.includes('link'))
    assert.ok(config.tools.includes('heading'))
    assert.ok(config.tools.includes('bulletList'))
    assert.ok(!config.tools.includes('undo'))
    assert.ok(!config.tools.includes('align'))
  })

  it('resolves minimal profile', () => {
    const config = resolveToolbar('minimal')
    assert.equal(config.profile, 'minimal')
    assert.equal(config.fixed, false)
    assert.deepEqual(config.tools, ['bold', 'italic', 'link'])
  })

  it('resolves none profile with empty tools', () => {
    const config = resolveToolbar('none')
    assert.equal(config.profile, 'none')
    assert.equal(config.fixed, false)
    assert.deepEqual(config.tools, [])
  })

  it('accepts explicit tool array', () => {
    const tools: ToolbarTool[] = ['bold', 'italic', 'heading']
    const config = resolveToolbar(tools)
    assert.equal(config.profile, 'default')
    assert.equal(config.fixed, false)
    assert.deepEqual(config.tools, tools)
  })

  it('only document profile is fixed', () => {
    const profiles: ToolbarProfile[] = ['default', 'document', 'simple', 'minimal', 'none']
    for (const p of profiles) {
      const config = resolveToolbar(p)
      assert.equal(config.fixed, p === 'document', `${p} should ${p === 'document' ? '' : 'not '}be fixed`)
    }
  })
})

describe('hasTool', () => {
  it('returns true for included tools', () => {
    const config = resolveToolbar('default')
    assert.equal(hasTool(config, 'bold'), true)
    assert.equal(hasTool(config, 'italic'), true)
  })

  it('returns false for excluded tools', () => {
    const config = resolveToolbar('minimal')
    assert.equal(hasTool(config, 'heading'), false)
    assert.equal(hasTool(config, 'undo'), false)
  })
})

describe('hasHeadingTool', () => {
  it('returns true when heading is in tools', () => {
    const config = resolveToolbar('document')
    assert.equal(hasHeadingTool(config), true)
  })

  it('returns true for explicit h1/h2/h3', () => {
    const config = resolveToolbar(['h1', 'bold'] as ToolbarTool[])
    assert.equal(hasHeadingTool(config), true)
  })

  it('returns false when no heading tools', () => {
    const config = resolveToolbar('minimal')
    assert.equal(hasHeadingTool(config), false)
  })
})
