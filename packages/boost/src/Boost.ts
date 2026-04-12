import type { BoostAgent } from './agents/types.js'
import { builtInAgents } from './agents/index.js'

export class Boost {
  private static customAgents = new Map<string, BoostAgent>()

  static registerAgent(agent: BoostAgent): void {
    this.customAgents.set(agent.name, agent)
  }

  static getCustomAgents(): Map<string, BoostAgent> {
    return new Map(this.customAgents)
  }

  static getAllAgents(): BoostAgent[] {
    const agentMap = new Map<string, BoostAgent>()

    for (const agent of builtInAgents()) {
      agentMap.set(agent.name, agent)
    }

    // Custom agents override built-in by name
    for (const [name, agent] of this.customAgents) {
      agentMap.set(name, agent)
    }

    return [...agentMap.values()]
  }

  static clearCustomAgents(): void {
    this.customAgents.clear()
  }
}
