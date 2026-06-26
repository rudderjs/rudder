import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getRegisteredChecks, resetDoctorRegistry } from '@rudderjs/console'

describe('@rudderjs/ai doctor check', () => {
  it('registers the ai:provider-keys check on import', async () => {
    resetDoctorRegistry()
    await import('./doctor.js')   // side-effect: registers the check
    const check = getRegisteredChecks().find(c => c.id === 'ai:provider-keys')
    assert.ok(check, 'ai:provider-keys check should be registered')
    assert.equal(check.category, 'ai')
    assert.equal(check.title, 'AI provider API keys')
  })

  it('run() reports ok when no config/ai.ts is present', async () => {
    await import('./doctor.js')
    const check = getRegisteredChecks().find(c => c.id === 'ai:provider-keys')!
    const result = await check.run()
    // The test process has no config/ai.ts in cwd, so the check no-ops to ok.
    assert.equal(result.status, 'ok')
  })
})
