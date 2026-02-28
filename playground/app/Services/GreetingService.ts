import { Injectable } from '@forge/core'

@Injectable()
export class GreetingService {
  greet(name: string): string {
    return `Hello, ${name}! Welcome to Forge ⚡`
  }
}
