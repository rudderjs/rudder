import type { ProviderFactory, ProviderAdapter } from './types.js'

export class AiRegistry {
  private static readonly factories = new Map<string, ProviderFactory>()
  private static _default: string | null = null

  /** Register a provider factory */
  static register(factory: ProviderFactory): void {
    this.factories.set(factory.name, factory)
  }

  /** Get a registered provider factory by name */
  static getFactory(name: string): ProviderFactory {
    const f = this.factories.get(name)
    if (!f) throw new Error(`[BoostKit AI] Unknown AI provider "${name}". Register it first.`)
    return f
  }

  /** Set the default provider/model string */
  static setDefault(modelString: string): void {
    this._default = modelString
  }

  /** Get the default provider/model string */
  static getDefault(): string {
    if (!this._default) throw new Error('[BoostKit AI] No default model set. Add ai() to providers with a config.')
    return this._default
  }

  /** Parse 'provider/model' string into [providerName, modelId] */
  static parseModelString(modelString: string): [string, string] {
    const slash = modelString.indexOf('/')
    if (slash === -1) throw new Error(`[BoostKit AI] Invalid model string "${modelString}". Expected "provider/model" format.`)
    return [modelString.slice(0, slash), modelString.slice(slash + 1)]
  }

  /** Resolve a provider/model string to a ProviderAdapter */
  static resolve(modelString: string): ProviderAdapter {
    const [providerName, model] = this.parseModelString(modelString)
    const factory = this.getFactory(providerName)
    return factory.create(model)
  }

  /** @internal — reset for testing */
  static reset(): void {
    this.factories.clear()
    this._default = null
  }
}
