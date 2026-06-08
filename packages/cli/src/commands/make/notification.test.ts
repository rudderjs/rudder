import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stub } from './notification.js'

describe('make:notification — stub', () => {
  it('emits a class extending Notification from @rudderjs/notification', () => {
    const out = stub('WelcomeNotification')
    assert.match(out, /export class WelcomeNotification extends Notification/)
    assert.match(out, /from '@rudderjs\/notification'/)
  })

  it('scaffolds via() returning channel names and a matching builder', () => {
    const out = stub('WelcomeNotification')
    assert.match(out, /via\(_notifiable: Notifiable\): string\[\]/)
    assert.match(out, /toDatabase\(_notifiable: Notifiable\): Record<string, unknown>/)
  })

  it('references the send call with the class name', () => {
    assert.match(stub('InvoiceNotification'), /notify\(user, new InvoiceNotification\(\)\)/)
  })
})
