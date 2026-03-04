import { Injectable } from '@boostkit/core'

@Injectable()
export class GreetingService {
  greet(name: string): string {
    return `Hello, ${name}! Welcome to BoostKit ⚡`
  }
}
