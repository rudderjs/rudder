import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { workspaces } from './plugin.js'
import { WorkspaceResource } from './resources/WorkspaceResource.js'
import { DepartmentResource } from './resources/DepartmentResource.js'
import { AgentResource } from './resources/AgentResource.js'
import { KnowledgeBaseResource } from './resources/KnowledgeBaseResource.js'
import { DocumentResource } from './resources/DocumentResource.js'

describe('workspaces() plugin', () => {
  it('returns a PanelPlugin with schemas', () => {
    const plugin = workspaces()
    assert.ok(plugin.schemas)
    assert.strictEqual(plugin.schemas.length, 1)
    assert.strictEqual(plugin.schemas[0]!.tag, 'workspaces-schema')
    assert.strictEqual(plugin.schemas[0]!.orm, 'prisma')
  })

  it('has register and boot hooks', () => {
    const plugin = workspaces()
    assert.ok(typeof plugin.register === 'function')
    assert.ok(typeof plugin.boot === 'function')
  })
})

describe('WorkspaceResource', () => {
  it('has correct static properties', () => {
    assert.strictEqual(WorkspaceResource.label, 'Workspaces')
    assert.strictEqual(WorkspaceResource.icon, 'layout-dashboard')
    assert.strictEqual(WorkspaceResource.navigationGroup, 'AI')
  })

  it('getSlug() derives slug from class name', () => {
    assert.strictEqual(WorkspaceResource.getSlug(), 'workspaces')
  })
})

describe('DepartmentResource', () => {
  it('has correct static properties', () => {
    assert.strictEqual(DepartmentResource.label, 'Departments')
    assert.strictEqual(DepartmentResource.icon, 'building-2')
  })
})

describe('AgentResource', () => {
  it('has correct static properties', () => {
    assert.strictEqual(AgentResource.label, 'Agents')
    assert.strictEqual(AgentResource.icon, 'bot')
  })
})

describe('KnowledgeBaseResource', () => {
  it('has correct static properties', () => {
    assert.strictEqual(KnowledgeBaseResource.label, 'Knowledge Bases')
    assert.strictEqual(KnowledgeBaseResource.icon, 'library')
  })
})

describe('DocumentResource', () => {
  it('has correct static properties', () => {
    assert.strictEqual(DocumentResource.label, 'Documents')
    assert.strictEqual(DocumentResource.icon, 'file-text')
  })
})
