import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string): string {
  return `import { Notification, type Notifiable } from '@rudderjs/notification'

/**
 * Notification. Send it with notify(user, new ${className}()).
 * Declare the channels in via(), then implement the matching builder
 * (toMail / toDatabase / toBroadcast).
 */
export class ${className} extends Notification {
  via(_notifiable: Notifiable): string[] {
    // TODO: choose channels — 'mail', 'database', 'broadcast'
    return ['database']
  }

  toDatabase(_notifiable: Notifiable): Record<string, unknown> {
    return {
      // TODO: the data to persist for this notification
    }
  }

  // toMail(notifiable: Notifiable) {
  //   return new SomeMailable()
  // }
}
`
}

export function makeNotification(program: Command): void {
  registerMake(program, {
    command:     'make:notification',
    description: 'Create a new notification class',
    label:       'Notification created',
    suffix:      'Notification',
    directory:   'app/Notifications',
    testKind:    'unit',
    stub,
  })
}
