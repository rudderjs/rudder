import { Injectable } from '@rudderjs/core'

@Injectable()
export class GreetingService {
  greet(name: string): string {
    return `Hello, ${name}! Welcome to RudderJS ⚡`
  }
}
